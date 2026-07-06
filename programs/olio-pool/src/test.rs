extern crate std;

use super::fixture::*;
use super::groth16::{verify, Proof, VerificationKey};
use super::{Error, PoolContract, PoolContractClient};
use soroban_sdk::{
    crypto::bn254::Bn254Fr, testutils::Address as _, token, Address, Bytes, BytesN, Env, String,
    U256, Vec,
};

// Fixture note (from circuits/build/gen_input.mjs): ownerSecret=111111111111,
// salt=222222222222, amount=50000000, inserted at leaf 0.
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

fn fixture_signals(env: &Env) -> Vec<Bn254Fr> {
    let mut v = Vec::new(env);
    for s in PUB_SIGNALS {
        let u = U256::from_be_bytes(env, &Bytes::from_array(env, &decode::<32>(env, s).to_array()));
        v.push_back(Bn254Fr::from_u256(u));
    }
    v
}

// --- the crucial encoding test: a real snarkjs proof verifies on-chain --------

#[test]
fn groth16_verifies_real_proof() {
    let env = Env::default();
    assert!(verify(&env, &fixture_vk(&env), &fixture_proof(&env), &fixture_signals(&env)));
}

#[test]
fn groth16_rejects_tampered_signal() {
    let env = Env::default();
    let mut signals = fixture_signals(&env);
    // Flip the amount public signal.
    signals.set(3, Bn254Fr::from_u256(U256::from_u32(&env, 999)));
    assert!(!verify(&env, &fixture_vk(&env), &fixture_proof(&env), &signals));
}

// --- contract tree parity: contract Poseidon root == circuit root -------------

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
    let id = env.register(PoolContract, ());
    let pool = PoolContractClient::new(&env, &id);
    pool.initialize(&admin, &asset, &20);
    Fx { env, pool, payer, admin, asset }
}

fn dummy_bytes(env: &Env) -> (BytesN<32>, Bytes) {
    (BytesN::from_array(env, &[0u8; 32]), Bytes::from_array(env, &[1u8, 2, 3]))
}

#[test]
fn deposit_tree_root_matches_circuit() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let commitment = decode::<32>(&f.env, FIX_COMMITMENT);

    let token = token::Client::new(&f.env, &f.asset);
    let idx = f.pool.deposit(&f.payer, &commitment, &50_000_000, &eph, &ct);
    assert_eq!(idx, 0);
    assert_eq!(f.pool.leaf_count(), 1);
    assert_eq!(token.balance(&f.pool.address), 50_000_000);
    // The contract's Poseidon tree lands on exactly the root the circuit proved.
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, FIX_ROOT));
}

#[test]
fn double_initialize_rejected() {
    let f = setup();
    let err = f.pool.try_initialize(&f.admin, &f.asset, &20).err().unwrap();
    assert_eq!(err, Ok(Error::AlreadyInitialized));
}

#[test]
fn withdraw_requires_verifier_key() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    f.pool.deposit(&f.payer, &decode::<32>(&f.env, FIX_COMMITMENT), &50_000_000, &eph, &ct);
    let root = f.pool.current_root();
    let recipient = String::from_str(&f.env, "GDUMMY");
    let err = f
        .pool
        .try_withdraw(&recipient, &50_000_000, &root, &decode::<32>(&f.env, FIX_ROOT), &fixture_proof(&f.env))
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::VerifierKeyNotSet));
}

#[test]
fn withdraw_unknown_root_rejected() {
    let f = setup();
    f.pool.set_verifier_key(&f.admin, &fixture_vk(&f.env));
    let bogus_root = BytesN::from_array(&f.env, &[9u8; 32]);
    let recipient = String::from_str(&f.env, "GDUMMY");
    let err = f
        .pool
        .try_withdraw(&recipient, &50_000_000, &bogus_root, &decode::<32>(&f.env, FIX_ROOT), &fixture_proof(&f.env))
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::UnknownRoot));
}
