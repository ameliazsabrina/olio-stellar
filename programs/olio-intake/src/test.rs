#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, Bytes, BytesN, Env, IntoVal, Val,
};

#[contract]
struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn __constructor(env: Env, asset: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("asset"), &asset);
    }

    pub fn deposit(
        env: Env,
        from: Address,
        _commitment: BytesN<32>,
        amount: i128,
        quote: FeeQuote,
        _signature: BytesN<64>,
        _proof: Val,
        _ephemeral_pk: BytesN<32>,
        _ciphertext: Bytes,
    ) -> u32 {
        from.require_auth();
        let asset: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("asset"))
            .unwrap();
        assert_eq!(quote.payment_amount, amount);
        let total = quote.total_amount;
        token::Client::new(&env, &asset).transfer(&from, &env.current_contract_address(), &total);
        7
    }
}

fn quote(f: &Fixture, commitment: &BytesN<32>, amount: i128, fee_bps: u32) -> FeeQuote {
    let fee_amount = amount * fee_bps as i128 / 10_000;
    FeeQuote {
        format_version: 1,
        policy_version: 2,
        quote_id: BytesN::from_array(&f.env, &[4; 32]),
        network_id: f.env.ledger().network_id(),
        pool: f.pool.clone(),
        depositor: f.intake.clone(),
        commitment: commitment.clone(),
        payment_amount: amount,
        fee_bps,
        fee_amount,
        total_amount: amount + fee_amount,
        channel: FeeChannel::Cctp,
        source_domain: 3,
        source_payer: BytesN::from_array(&f.env, &[5; 32]),
        issued_at: 0,
        expires_at: 3600,
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

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = sac.address();

    let pool = env.register(MockPool, (asset.clone(),));
    let intake = env.register(IntakeContract, (admin.clone(), pool.clone(), asset.clone()));

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

    let proof: Val = ().into_val(&f.env);
    let quote = quote(&f, &commitment, 600, 200);
    let signature = BytesN::from_array(&f.env, &[7; 64]);
    let leaf = client.deposit_to_pool(&commitment, &600, &quote, &signature, &proof, &eph, &ct);

    assert_eq!(leaf, 7, "returns the pool's leaf index");
    assert_eq!(token.balance(&f.intake), 388, "612 left the intake");
    assert_eq!(token.balance(&f.pool), 612, "pool received the gross funds");
}

#[test]
fn deposit_forwards_special_tier_gross_total() {
    let f = setup(1_000);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    let token = token::Client::new(&f.env, &f.asset);
    let commitment = BytesN::from_array(&f.env, &[10u8; 32]);
    let eph = BytesN::from_array(&f.env, &[11u8; 32]);
    let ct = Bytes::from_array(&f.env, &[12u8; 16]);
    let proof: Val = ().into_val(&f.env);
    let quote = quote(&f, &commitment, 600, 500);
    let signature = BytesN::from_array(&f.env, &[13; 64]);

    client.deposit_to_pool(&commitment, &600, &quote, &signature, &proof, &eph, &ct);
    assert_eq!(token.balance(&f.intake), 370);
    assert_eq!(token.balance(&f.pool), 630);
}

#[test]
fn insufficient_gross_balance_rolls_back_forwarding() {
    let f = setup(611);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    let token = token::Client::new(&f.env, &f.asset);
    let commitment = BytesN::from_array(&f.env, &[14u8; 32]);
    let eph = BytesN::from_array(&f.env, &[15u8; 32]);
    let ct = Bytes::from_array(&f.env, &[16u8; 16]);
    let proof: Val = ().into_val(&f.env);
    let quote = quote(&f, &commitment, 600, 200);
    let signature = BytesN::from_array(&f.env, &[17; 64]);

    assert!(client
        .try_deposit_to_pool(&commitment, &600, &quote, &signature, &proof, &eph, &ct)
        .is_err());
    assert_eq!(token.balance(&f.intake), 611);
    assert_eq!(token.balance(&f.pool), 0);
}

#[test]
fn deposit_allows_floor_rounded_zero_fee() {
    let f = setup(10);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    let token = token::Client::new(&f.env, &f.asset);
    let commitment = BytesN::from_array(&f.env, &[6u8; 32]);
    let eph = BytesN::from_array(&f.env, &[7u8; 32]);
    let ct = Bytes::from_array(&f.env, &[8u8; 8]);
    let proof: Val = ().into_val(&f.env);
    let quote = quote(&f, &commitment, 10, 200);
    let signature = BytesN::from_array(&f.env, &[9; 64]);

    assert_eq!(quote.fee_amount, 0);
    assert_eq!(quote.total_amount, 10);
    client.deposit_to_pool(&commitment, &10, &quote, &signature, &proof, &eph, &ct);
    assert_eq!(token.balance(&f.intake), 0);
    assert_eq!(token.balance(&f.pool), 10);
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

    let proof: Val = ().into_val(&f.env);
    let quote = quote(&f, &commitment, 0, 200);
    let signature = BytesN::from_array(&f.env, &[7; 64]);
    let res = client.try_deposit_to_pool(&commitment, &0, &quote, &signature, &proof, &eph, &ct);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn requires_admin_auth() {
    let f = setup(1_000);
    let _ = &f.admin;
    let client = IntakeContractClient::new(&f.env, &f.intake);

    let commitment = BytesN::from_array(&f.env, &[1u8; 32]);
    let eph = BytesN::from_array(&f.env, &[2u8; 32]);
    let ct = Bytes::from_array(&f.env, &[3u8; 8]);

    let attacker = Address::generate(&f.env);
    let proof: Val = ().into_val(&f.env);
    let quote = quote(&f, &commitment, 500, 200);
    let signature = BytesN::from_array(&f.env, &[7; 64]);
    let res = client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &f.intake,
                fn_name: "deposit_to_pool",
                args: (
                    commitment.clone(),
                    500_i128,
                    quote.clone(),
                    signature.clone(),
                    proof.clone(),
                    eph.clone(),
                    ct.clone(),
                )
                    .into_val(&f.env),
                sub_invokes: &[],
            },
        }])
        .try_deposit_to_pool(&commitment, &500, &quote, &signature, &proof, &eph, &ct);

    assert!(res.is_err(), "only the admin may forward funds");
}

#[test]
fn rejects_quote_for_wrong_depositor() {
    let f = setup(1_000);
    let client = IntakeContractClient::new(&f.env, &f.intake);
    let commitment = BytesN::from_array(&f.env, &[1u8; 32]);
    let eph = BytesN::from_array(&f.env, &[2u8; 32]);
    let ct = Bytes::from_array(&f.env, &[0u8; 8]);
    let proof: Val = ().into_val(&f.env);
    let mut quote = quote(&f, &commitment, 500, 200);
    quote.depositor = Address::generate(&f.env);
    let signature = BytesN::from_array(&f.env, &[7; 64]);
    assert_eq!(
        client
            .try_deposit_to_pool(&commitment, &500, &quote, &signature, &proof, &eph, &ct)
            .err()
            .unwrap(),
        Ok(Error::InvalidQuote)
    );
}
