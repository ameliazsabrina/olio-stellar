extern crate std;

use super::fixture::*;
use super::groth16::{verify, Proof, VerificationKey};
use super::{Error, PoolContract, PoolContractClient};
use soroban_sdk::{
    crypto::bn254::Bn254Fr,
    symbol_short,
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    token, Address, Bytes, BytesN, Env, IntoVal, String, Vec, U256,
};

const FIX_COMMITMENT: &str = "22f7c82788b172ce0fc90e436bd633c700d8e736a7e85752f8e993c3dad9930d";
const FIX_ROOT: &str = "0f858c902c0d5f577f7ac38a8fb185f3f14247ce1d6f15d75deae22f36aad360";

fn hex_to_vec(s: &str) -> std::vec::Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn decode<const N: usize>(env: &Env, s: &str) -> BytesN<N> {
    let v = hex_to_vec(s);
    assert_eq!(v.len(), N, "hex len mismatch");
    let mut arr = [0u8; N];
    arr.copy_from_slice(&v);
    BytesN::from_array(env, &arr)
}

fn fixture_vk(env: &Env) -> VerificationKey {
    let mut ic = Vec::new(env);
    for s in VK_IC {
        ic.push_back(decode::<64>(env, s));
    }
    VerificationKey {
        alpha: decode::<64>(env, VK_ALPHA),
        beta: decode::<128>(env, VK_BETA),
        gamma: decode::<128>(env, VK_GAMMA),
        delta: decode::<128>(env, VK_DELTA),
        ic,
    }
}

fn fixture_proof(env: &Env) -> Proof {
    Proof {
        a: decode::<64>(env, PROOF_A),
        b: decode::<128>(env, PROOF_B),
        c: decode::<64>(env, PROOF_C),
    }
}

fn transfer_vk(env: &Env) -> VerificationKey {
    use super::transfer_fixture::*;
    let mut ic = Vec::new(env);
    for s in TR_VK_IC {
        ic.push_back(decode::<64>(env, s));
    }
    VerificationKey {
        alpha: decode::<64>(env, TR_VK_ALPHA),
        beta: decode::<128>(env, TR_VK_BETA),
        gamma: decode::<128>(env, TR_VK_GAMMA),
        delta: decode::<128>(env, TR_VK_DELTA),
        ic,
    }
}

fn deposit_vk(env: &Env) -> VerificationKey {
    use super::deposit_fixture::*;
    let mut ic = Vec::new(env);
    for s in DP_VK_IC {
        ic.push_back(decode::<64>(env, s));
    }
    VerificationKey {
        alpha: decode::<64>(env, DP_VK_ALPHA),
        beta: decode::<128>(env, DP_VK_BETA),
        gamma: decode::<128>(env, DP_VK_GAMMA),
        delta: decode::<128>(env, DP_VK_DELTA),
        ic,
    }
}

fn deposit_proof(env: &Env) -> Proof {
    use super::deposit_fixture::*;
    Proof {
        a: decode::<64>(env, DP_PROOF_A),
        b: decode::<128>(env, DP_PROOF_B),
        c: decode::<64>(env, DP_PROOF_C),
    }
}

fn wd_deposit_proof(env: &Env) -> Proof {
    use super::deposit_fixture::*;
    Proof {
        a: decode::<64>(env, DP_WD_PROOF_A),
        b: decode::<128>(env, DP_WD_PROOF_B),
        c: decode::<64>(env, DP_WD_PROOF_C),
    }
}

fn fixture_signals(env: &Env) -> Vec<Bn254Fr> {
    let mut v = Vec::new(env);
    for s in PUB_SIGNALS {
        let u = U256::from_be_bytes(
            env,
            &Bytes::from_array(env, &decode::<32>(env, s).to_array()),
        );
        v.push_back(Bn254Fr::from_u256(u));
    }
    v
}


#[test]
fn groth16_verifies_real_proof() {
    let env = Env::default();
    assert!(verify(
        &env,
        &fixture_vk(&env),
        &fixture_proof(&env),
        &fixture_signals(&env)
    ));
}

#[test]
fn groth16_rejects_tampered_signal() {
    let env = Env::default();
    let mut signals = fixture_signals(&env);
    signals.set(3, Bn254Fr::from_u256(U256::from_u32(&env, 999)));
    assert!(!verify(
        &env,
        &fixture_vk(&env),
        &fixture_proof(&env),
        &signals
    ));
}


struct Fx<'a> {
    env: Env,
    pool: PoolContractClient<'a>,
    payer: Address,
    admin: Address,
    asset: Address,
}

fn setup<'a>() -> Fx<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = sac.address();
    let payer = Address::generate(&env);
    token::StellarAssetClient::new(&env, &asset).mint(&payer, &1_000_0000000);
    let id = env.register(PoolContract, (admin.clone(), asset.clone(), 20u32));
    let pool = PoolContractClient::new(&env, &id);
    pool.set_deposit_verifier_key(&deposit_vk(&env));
    Fx {
        env,
        pool,
        payer,
        admin,
        asset,
    }
}

#[test]
#[should_panic]
fn invalid_constructor_depth_rejected() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    env.register(PoolContract, (admin, asset, 0u32));
}

fn dummy_bytes(env: &Env) -> (BytesN<32>, Bytes) {
    (
        BytesN::from_array(env, &[0u8; 32]),
        Bytes::from_array(env, &[1u8, 2, 3]),
    )
}

#[test]
fn deposit_tree_root_matches_circuit() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let commitment = decode::<32>(&f.env, FIX_COMMITMENT);

    let token = token::Client::new(&f.env, &f.asset);
    let idx = f.pool.deposit(
        &f.payer,
        &commitment,
        &50_000_000,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(idx, 0);
    assert_eq!(f.pool.leaf_count(), 1);
    assert_eq!(token.balance(&f.pool.address), 50_000_000);
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, FIX_ROOT));
}

#[test]
fn deposit_rejects_commitment_not_bound_to_amount_atomically() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let token = token::Client::new(&f.env, &f.asset);
    let payer_before = token.balance(&f.payer);

    let err = f
        .pool
        .try_deposit(
            &f.payer,
            &decode(&f.env, FIX_COMMITMENT),
            &1,
            &deposit_proof(&f.env),
            &eph,
            &ct,
        )
        .err()
        .unwrap();

    assert_eq!(err, Ok(Error::InvalidProof));
    assert_eq!(f.pool.leaf_count(), 0);
    assert_eq!(token.balance(&f.pool.address), 0);
    assert_eq!(token.balance(&f.payer), payer_before);
}

#[test]
fn deposit_rejects_amount_outside_circuit_range() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let err = f
        .pool
        .try_deposit(
            &f.payer,
            &decode(&f.env, FIX_COMMITMENT),
            &((u64::MAX as i128) + 1),
            &deposit_proof(&f.env),
            &eph,
            &ct,
        )
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::InvalidAmount));
}

#[test]
fn withdraw_requires_verifier_key() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, FIX_COMMITMENT),
        &50_000_000,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    let root = f.pool.current_root();
    let recipient = String::from_str(&f.env, "GDUMMY");
    let err = f
        .pool
        .try_withdraw(
            &recipient,
            &50_000_000,
            &root,
            &decode::<32>(&f.env, FIX_ROOT),
            &fixture_proof(&f.env),
        )
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::VerifierKeyNotSet));
}

#[test]
fn withdraw_full_flow() {
    use super::withdraw_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let token = token::Client::new(&f.env, &f.asset);

    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, WD_COMMITMENT),
        &WD_AMOUNT,
        &wd_deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, WD_ROOT));
    f.pool.set_verifier_key(&fixture_vk(&f.env));
    assert_eq!(token.balance(&f.pool.address), WD_AMOUNT);

    let recipient = String::from_str(&f.env, WD_RECIPIENT);
    let dest = Address::from_string(&recipient);
    let root = decode::<32>(&f.env, WD_ROOT);
    let nullifier = decode::<32>(&f.env, WD_NULLIFIER);
    let proof = Proof {
        a: decode::<64>(&f.env, WD_PROOF_A),
        b: decode::<128>(&f.env, WD_PROOF_B),
        c: decode::<64>(&f.env, WD_PROOF_C),
    };

    f.pool
        .withdraw(&recipient, &WD_AMOUNT, &root, &nullifier, &proof);
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool.address),
        soroban_sdk::vec![
            &f.env,
            (
                f.pool.address.clone(),
                (symbol_short!("withdraw"),).into_val(&f.env),
                (nullifier.clone(), dest.clone(), WD_AMOUNT).into_val(&f.env),
            ),
            (
                f.pool.address.clone(),
                (symbol_short!("spend"),).into_val(&f.env),
                nullifier.clone().into_val(&f.env),
            ),
        ]
    );
    assert_eq!(token.balance(&dest), WD_AMOUNT);
    assert_eq!(token.balance(&f.pool.address), 0);

    let err = f
        .pool
        .try_withdraw(&recipient, &WD_AMOUNT, &root, &nullifier, &proof)
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::DoubleSpend));
}

#[test]
fn transfer_full_flow() {
    use super::transfer_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let token = token::Client::new(&f.env, &f.asset);

    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, TR_IN_COMMITMENT),
        &TR_IN_AMOUNT,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, TR_ROOT));
    assert_eq!(token.balance(&f.pool.address), TR_IN_AMOUNT);

    f.pool.set_transfer_verifier_key(&transfer_vk(&f.env));
    assert!(f.pool.has_transfer_verifier_key());

    let root = decode::<32>(&f.env, TR_ROOT);
    let nullifier = decode::<32>(&f.env, TR_NULLIFIER);
    let proof = Proof {
        a: decode::<64>(&f.env, TR_PROOF_A),
        b: decode::<128>(&f.env, TR_PROOF_B),
        c: decode::<64>(&f.env, TR_PROOF_C),
    };
    let recipient_com = decode::<32>(&f.env, TR_RECIPIENT_COMMITMENT);
    let change_com = decode::<32>(&f.env, TR_CHANGE_COMMITMENT);

    let (recipient_index, change_index) = f.pool.transfer(
        &root,
        &nullifier,
        &proof,
        &recipient_com,
        &eph,
        &ct,
        &change_com,
        &eph,
        &ct,
    );
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool.address),
        soroban_sdk::vec![
            &f.env,
            (
                f.pool.address.clone(),
                (symbol_short!("deposit"),).into_val(&f.env),
                (1u32, recipient_com.clone(), eph.clone(), ct.clone()).into_val(&f.env),
            ),
            (
                f.pool.address.clone(),
                (symbol_short!("deposit"),).into_val(&f.env),
                (2u32, change_com.clone(), eph.clone(), ct.clone()).into_val(&f.env),
            ),
            (
                f.pool.address.clone(),
                (symbol_short!("spend"),).into_val(&f.env),
                nullifier.clone().into_val(&f.env),
            ),
        ]
    );
    assert_eq!(recipient_index, 1);
    assert_eq!(change_index, 2);
    assert_eq!(f.pool.leaf_count(), 3);
    assert!(f.pool.is_spent(&nullifier));
    assert_eq!(token.balance(&f.pool.address), TR_IN_AMOUNT);

    let err = f
        .pool
        .try_transfer(
            &root,
            &nullifier,
            &proof,
            &recipient_com,
            &eph,
            &ct,
            &change_com,
            &eph,
            &ct,
        )
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::DoubleSpend));
}

#[test]
fn transfer_requires_verifier_key() {
    use super::transfer_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, TR_IN_COMMITMENT),
        &TR_IN_AMOUNT,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    let root = f.pool.current_root();
    let proof = Proof {
        a: decode::<64>(&f.env, TR_PROOF_A),
        b: decode::<128>(&f.env, TR_PROOF_B),
        c: decode::<64>(&f.env, TR_PROOF_C),
    };
    let recipient_com = decode::<32>(&f.env, TR_RECIPIENT_COMMITMENT);
    let change_com = decode::<32>(&f.env, TR_CHANGE_COMMITMENT);
    let err = f
        .pool
        .try_transfer(
            &root,
            &decode::<32>(&f.env, TR_NULLIFIER),
            &proof,
            &recipient_com,
            &eph,
            &ct,
            &change_com,
            &eph,
            &ct,
        )
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::VerifierKeyNotSet));
}

#[test]
fn withdraw_unknown_root_rejected() {
    let f = setup();
    f.pool.set_verifier_key(&fixture_vk(&f.env));
    let bogus_root = BytesN::from_array(&f.env, &[9u8; 32]);
    let recipient = String::from_str(&f.env, "GDUMMY");
    let err = f
        .pool
        .try_withdraw(
            &recipient,
            &50_000_000,
            &bogus_root,
            &decode::<32>(&f.env, FIX_ROOT),
            &fixture_proof(&f.env),
        )
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::UnknownRoot));
}


#[test]
fn pause_blocks_deposit_withdraw_transfer() {
    use super::withdraw_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);

    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, WD_COMMITMENT),
        &WD_AMOUNT,
        &wd_deposit_proof(&f.env),
        &eph,
        &ct,
    );
    f.pool.set_verifier_key(&fixture_vk(&f.env));
    let recipient = String::from_str(&f.env, WD_RECIPIENT);
    let root = decode::<32>(&f.env, WD_ROOT);
    let nullifier = decode::<32>(&f.env, WD_NULLIFIER);
    let proof = Proof {
        a: decode::<64>(&f.env, WD_PROOF_A),
        b: decode::<128>(&f.env, WD_PROOF_B),
        c: decode::<64>(&f.env, WD_PROOF_C),
    };

    f.pool.pause();
    assert!(f.pool.is_paused());

    assert_eq!(
        f.pool
            .try_deposit(&f.payer, &nullifier, &1, &proof, &nullifier, &ct)
            .err()
            .unwrap(),
        Ok(Error::Paused)
    );
    assert_eq!(
        f.pool
            .try_withdraw(&recipient, &WD_AMOUNT, &root, &nullifier, &proof)
            .err()
            .unwrap(),
        Ok(Error::Paused)
    );
    assert_eq!(
        f.pool
            .try_transfer(
                &root, &nullifier, &proof, &nullifier, &nullifier, &ct, &nullifier, &nullifier, &ct
            )
            .err()
            .unwrap(),
        Ok(Error::Paused)
    );

    f.pool.unpause();
    assert!(!f.pool.is_paused());
    let token = token::Client::new(&f.env, &f.asset);
    f.pool
        .withdraw(&recipient, &WD_AMOUNT, &root, &nullifier, &proof);
    assert_eq!(token.balance(&Address::from_string(&recipient)), WD_AMOUNT);
    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, FIX_COMMITMENT),
        &50_000_000,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
}

#[test]
fn only_admin_can_pause() {
    let f = setup();
    f.env.set_auths(&[]);
    assert!(f.pool.try_pause().is_err());
}

#[test]
fn only_admin_can_upgrade() {
    let f = setup();
    f.env.set_auths(&[]);
    let hash = BytesN::from_array(&f.env, &[0u8; 32]);
    assert!(f.pool.try_upgrade(&hash).is_err());
}

#[test]
fn only_admin_can_set_verifier_key() {
    let f = setup();
    f.env.set_auths(&[]);
    assert!(f.pool.try_set_verifier_key(&fixture_vk(&f.env)).is_err());
}

#[test]
fn admin_handoff_transfers_control() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    f.pool.propose_admin(&new_admin);
    assert_eq!(f.pool.pending_admin(), Some(new_admin.clone()));
    f.pool.accept_admin();
    assert_eq!(f.pool.admin(), new_admin);
    assert_eq!(f.pool.pending_admin(), None);

    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "pause",
            args: ().into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.pool.try_pause().is_err());

    f.env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "pause",
            args: ().into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.pool.pause();
    assert!(f.pool.is_paused());
}

#[test]
fn admin_can_cancel_handoff() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    f.pool.propose_admin(&new_admin);
    f.pool.cancel_admin_transfer();
    assert_eq!(f.pool.pending_admin(), None);
    assert_eq!(f.pool.admin(), f.admin);
    assert_eq!(
        f.pool.try_accept_admin().err().unwrap(),
        Ok(Error::AdminTransferNotPending)
    );
}

#[test]
fn only_pending_admin_can_accept_handoff() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    let wrong_admin = Address::generate(&f.env);
    f.pool.propose_admin(&new_admin);

    f.env.mock_auths(&[MockAuth {
        address: &wrong_admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "accept_admin",
            args: ().into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.pool.try_accept_admin().is_err());
    assert_eq!(f.pool.admin(), f.admin);
    assert_eq!(f.pool.pending_admin(), Some(new_admin));
}
