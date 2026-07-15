#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, Bytes, BytesN, Env, IntoVal,
};

#[contract]
struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn __constructor(env: Env, asset: Address) {
        env.storage().instance().set(&symbol_short!("asset"), &asset);
    }

    pub fn deposit(
        env: Env,
        from: Address,
        _commitment: BytesN<32>,
        amount: i128,
        _ephemeral_pk: BytesN<32>,
        _ciphertext: Bytes,
    ) -> u32 {
        from.require_auth();
        let asset: Address = env.storage().instance().get(&symbol_short!("asset")).unwrap();
        token::Client::new(&env, &asset).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        7
    }
}

struct Fixture {
    env: Env,
    admin: Address,
    asset: Address,
    pool: Address,
    intake: Address,
}

fn setup(intake_funding: i128) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // USDC-like SAC; the issuer admin mints the intake its starting balance.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = sac.address();

    let pool = env.register(MockPool, (asset.clone(),));
    let intake = env.register(
        IntakeContract,
        (admin.clone(), pool.clone(), asset.clone()),
    );

    // Simulate the CCTP mint: credit USDC directly to the intake contract.
    token::StellarAssetClient::new(&env, &asset).mint(&intake, &intake_funding);

    Fixture {
        env,
        admin,
        asset,
        pool,
        intake,
    }
}

#[test]
fn deposit_forwards_balance_into_pool() {
    let f = setup(1_000);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    let token = token::Client::new(&f.env, &f.asset);

    let commitment = BytesN::from_array(&f.env, &[1u8; 32]);
    let eph = BytesN::from_array(&f.env, &[2u8; 32]);
    let ct = Bytes::from_array(&f.env, &[9u8; 16]);

    assert_eq!(token.balance(&f.intake), 1_000);
    assert_eq!(token.balance(&f.pool), 0);

    let leaf = client.deposit_to_pool(&commitment, &600, &eph, &ct);

    assert_eq!(leaf, 7, "returns the pool's leaf index");
    assert_eq!(token.balance(&f.intake), 400, "600 left the intake");
    assert_eq!(token.balance(&f.pool), 600, "pool received the funds");
}

#[test]
fn usdc_balance_reflects_mint() {
    let f = setup(2_500);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    assert_eq!(client.usdc_balance(), 2_500);
}

#[test]
fn rejects_non_positive_amount() {
    let f = setup(1_000);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    let (commitment, eph) = {
        let c = BytesN::from_array(&f.env, &[1u8; 32]);
        let e = BytesN::from_array(&f.env, &[2u8; 32]);
        (c, e)
    };
    let ct = Bytes::from_array(&f.env, &[0u8; 8]);

    let res = client.try_deposit_to_pool(&commitment, &0, &eph, &ct);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

// The drain guard: deposit_to_pool must fail unless the *admin* authorizes it.
// We authorize only a non-admin address' invocation and expect require_auth to
// reject it.
#[test]
fn requires_admin_auth() {
    let f = setup(1_000);
    let _ = &f.admin; // admin is the only address that should pass require_auth
    let client = IntakeContractClient::new(&f.env, &f.intake);

    let commitment = BytesN::from_array(&f.env, &[1u8; 32]);
    let eph = BytesN::from_array(&f.env, &[2u8; 32]);
    let ct = Bytes::from_array(&f.env, &[3u8; 8]);

    let attacker = Address::generate(&f.env);
    let res = client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &f.intake,
                fn_name: "deposit_to_pool",
                args: (commitment.clone(), 500_i128, eph.clone(), ct.clone()).into_val(&f.env),
                sub_invokes: &[],
            },
        }])
        .try_deposit_to_pool(&commitment, &500, &eph, &ct);

    assert!(res.is_err(), "only the admin may forward funds");
}
