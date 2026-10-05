extern crate std;

use super::fixture::*;
use super::groth16::{verify, Proof, VerificationKey};
use super::{
    DataKey, Error, FeeChannel, FeeQuote, GovernanceAction, PoolContract, PoolContractClient,
    VerifierKind, DEFAULT_FEE_BPS, FEE_POLICY_VERSION, FEE_QUOTE_FORMAT_VERSION,
    ISSUED_AT_CLOCK_SKEW_SECONDS, TIMELOCK_SECONDS, TTL_EXTEND, TTL_THRESHOLD,
};
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
    crypto::bn254::Bn254Fr,
    symbol_short,
    testutils::{
        storage::Instance as _, Address as _, Events as _, Ledger, MockAuth, MockAuthInvoke,
    },
    token,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, IntoVal, Map, String, Symbol, Val, Vec, U256,
};

const FIX_COMMITMENT: &str = "22f7c82788b172ce0fc90e436bd633c700d8e736a7e85752f8e993c3dad9930d";
const FIX_ROOT: &str = "0f858c902c0d5f577f7ac38a8fb185f3f14247ce1d6f15d75deae22f36aad360";
const UPGRADE_WASM_HEX: &str = "0061736d0100000001140460017e017e60027f7e0060027e7e017e600000020d020169013000000169015f0000030605010203030305030100100619037f01418080c0000b7f00418080c0000b7f00418080c0000b072f05066d656d6f72790200036164640003015f00060a5f5f646174615f656e6403010b5f5f686561705f6261736503020a8c02055d02017f017e024002402001a741ff0171220241c000460d00024020024106460d00420121034283908080800121010c020b20014208882101420021030c010b42002103200110808080800021010b20002001370308200020033703000b990101017f23808080800041206b2202248080808000200241106a20001082808080000240024020022802100d0020022903182100200220011082808080002002290300a70d00200020022903087c22012000540d0102400240200142ffffffffffffffff00560d00200142088642068421000c010b200110818080800021000b200241206a24808080800020000f0b00000b108480808000000b0900108580808000000b040000000b02000b004b0e636f6e7472616374737065637630000000000000000000000003616464000000000200000000000000016100000000000006000000000000000162000000000000060000000100000006001e11636f6e7472616374656e766d6574617630000000000000001500000000007b0e636f6e74726163746d65746176300000000000000005727376657200000000000006312e37342e3000000000000000000008727373646b7665720000003932312e302e312d707265766965772e312331313663333562633965303366346231623565363562356565383331616530663836616139326664000000";

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

#[test]
fn canonical_fee_quote_vector_matches_typescript() {
    let env = Env::default();
    let quote = FeeQuote {
        format_version: 1,
        policy_version: 2,
        quote_id: BytesN::from_array(&env, &[1; 32]),
        network_id: BytesN::from_array(&env, &[2; 32]),
        pool: Address::from_string(&String::from_str(
            &env,
            "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L",
        )),
        depositor: Address::from_string(&String::from_str(
            &env,
            "CAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQMCJ",
        )),
        commitment: BytesN::from_array(&env, &[3; 32]),
        payment_amount: 10_000_000,
        fee_bps: 200,
        fee_amount: 200_000,
        total_amount: 10_200_000,
        channel: FeeChannel::Cctp,
        source_domain: 1,
        source_payer: BytesN::from_array(&env, &[4; 32]),
        issued_at: 100,
        expires_at: 200,
    };
    let payment_bytes = (
        Bytes::from_slice(&env, super::PAYMENT_DOMAIN),
        super::payment_binding(&quote),
    )
        .to_xdr(&env);
    let auth_bytes = (
        Bytes::from_slice(&env, super::AUTH_DOMAIN),
        super::payment_binding_digest(&env, &quote),
        quote.issued_at,
        quote.expires_at,
    )
        .to_xdr(&env);
    let payment_digest = super::payment_binding_digest(&env, &quote);
    let auth_digest = super::authorization_digest(&env, &quote);
    let signature = quote_signing_key().sign(&auth_digest.to_array()).to_bytes();
    assert_eq!(
        hex::encode(payment_digest.to_array()),
        "6448badaa7b0c7283517240bda294c4179c648ba3cf6b471324aff3fc88463fd"
    );
    assert_eq!(
        hex::encode(auth_digest.to_array()),
        "19f1194b0d81937fb70c7731fe9c4ad299e315bd185d49831e97d4b0dc6c35f1"
    );
    assert_eq!(
        hex::encode(quote_signing_key().verifying_key().to_bytes()),
        "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"
    );
    assert_eq!(hex::encode(signature), "c31f7423dedc37908786a672085db08140a87b132c03ca8add66b3ffe4d20d4e082bff03ec4a001eb58cbb046131d88041cd5b75e93bcfb5c8e2387da246590d");
    assert!(!payment_bytes.is_empty());
    assert!(!auth_bytes.is_empty());
}
struct Fx<'a> {
    env: Env,
    pool: PoolContractClient<'a>,
    payer: Address,
    admin: Address,
    asset: Address,
    fee_recipient: Address,
}

fn quote_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn setup<'a>() -> Fx<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = sac.address();
    let payer = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let quote_signer = BytesN::from_array(&env, &quote_signing_key().verifying_key().to_bytes());
    token::StellarAssetClient::new(&env, &asset).mint(&payer, &1_000_0000000);
    let id = env.register(
        PoolContract,
        (
            admin.clone(),
            asset.clone(),
            fee_recipient.clone(),
            quote_signer,
            20u32,
            deposit_vk(&env),
            fixture_vk(&env),
            transfer_vk(&env),
        ),
    );
    let pool = PoolContractClient::new(&env, &id);
    Fx {
        env,
        pool,
        payer,
        admin,
        asset,
        fee_recipient,
    }
}

fn signed_quote(
    f: &Fx<'_>,
    from: &Address,
    commitment: &BytesN<32>,
    payment_amount: i128,
    fee_bps: u32,
) -> (FeeQuote, BytesN<64>) {
    let (fee_amount, total_amount) = f.pool.quote_fee(&payment_amount, &fee_bps);
    let quote = raw_quote(
        f,
        from,
        commitment,
        payment_amount,
        fee_bps,
        fee_amount,
        total_amount,
    );
    let digest = f.pool.authorization_digest(&quote);
    let sig = quote_signing_key().sign(&digest.to_array()).to_bytes();
    (quote, BytesN::from_array(&f.env, &sig))
}

fn raw_quote(
    f: &Fx<'_>,
    from: &Address,
    commitment: &BytesN<32>,
    payment_amount: i128,
    fee_bps: u32,
    fee_amount: i128,
    total_amount: i128,
) -> FeeQuote {
    let mut quote_id = commitment.to_array();
    quote_id[0] ^= f.pool.leaf_count() as u8;
    FeeQuote {
        format_version: FEE_QUOTE_FORMAT_VERSION,
        policy_version: FEE_POLICY_VERSION,
        quote_id: BytesN::from_array(&f.env, &quote_id),
        network_id: f.env.ledger().network_id(),
        pool: f.pool.address.clone(),
        depositor: from.clone(),
        commitment: commitment.clone(),
        payment_amount,
        fee_bps,
        fee_amount,
        total_amount,
        channel: FeeChannel::Direct,
        source_domain: 0,
        source_payer: BytesN::from_array(&f.env, &[0; 32]),
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 900,
    }
}

fn deposit(
    f: &Fx<'_>,
    from: &Address,
    commitment: &BytesN<32>,
    payment_amount: i128,
    proof: &Proof,
    ephemeral_pk: &BytesN<32>,
    ciphertext: &Bytes,
) -> u32 {
    let (quote, signature) = signed_quote(f, from, commitment, payment_amount, DEFAULT_FEE_BPS);
    f.pool.deposit(
        from,
        commitment,
        &payment_amount,
        &quote,
        &signature,
        proof,
        ephemeral_pk,
        ciphertext,
    )
}

#[test]
#[should_panic]
fn invalid_constructor_depth_rejected() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let fee_recipient = Address::generate(&env);
    env.register(
        PoolContract,
        (
            admin,
            asset,
            fee_recipient,
            BytesN::from_array(&env, &quote_signing_key().verifying_key().to_bytes()),
            0u32,
            deposit_vk(&env),
            fixture_vk(&env),
            transfer_vk(&env),
        ),
    );
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
    let payer_before = token.balance(&f.payer);
    let idx = deposit(
        &f,
        &f.payer,
        &commitment,
        50_000_000,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(idx, 0);
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool.address),
        soroban_sdk::vec![
            &f.env,
            (
                f.pool.address.clone(),
                (symbol_short!("deposit"),).into_val(&f.env),
                (0u32, commitment.clone(), eph.clone(), ct).into_val(&f.env),
            ),
            (
                f.pool.address.clone(),
                (symbol_short!("fee"),).into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (
                            Symbol::new(&f.env, "fee_amount"),
                            1_000_000_i128.into_val(&f.env)
                        ),
                        (Symbol::new(&f.env, "fee_bps"), 200_u32.into_val(&f.env)),
                        (
                            Symbol::new(&f.env, "fee_recipient"),
                            f.fee_recipient.clone().into_val(&f.env),
                        ),
                        (
                            Symbol::new(&f.env, "payer"),
                            f.payer.clone().into_val(&f.env),
                        ),
                        (
                            Symbol::new(&f.env, "payment_amount"),
                            50_000_000_i128.into_val(&f.env),
                        ),
                        (
                            Symbol::new(&f.env, "policy_version"),
                            2_u32.into_val(&f.env),
                        ),
                        (
                            Symbol::new(&f.env, "quote_id"),
                            commitment.clone().into_val(&f.env),
                        ),
                        (
                            Symbol::new(&f.env, "total_amount"),
                            51_000_000_i128.into_val(&f.env),
                        ),
                    ],
                )
                .into_val(&f.env),
            ),
        ]
    );
    assert_eq!(f.pool.leaf_count(), 1);
    assert_eq!(token.balance(&f.pool.address), 50_000_000);
    assert_eq!(token.balance(&f.fee_recipient), 1_000_000);
    assert_eq!(token.balance(&f.payer), payer_before - 51_000_000);
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, FIX_ROOT));
}

#[test]
fn fee_quotes_use_floor_rounding_and_preserve_principal() {
    let f = setup();
    for (principal, bps, fee, total) in [
        (1_i128, 200_u32, 0_i128, 1_i128),
        (49, 200, 0, 49),
        (50, 200, 1, 51),
        (1, 500, 0, 1),
        (19, 500, 0, 19),
        (20, 500, 1, 21),
        (10_000_000, 200, 200_000, 10_200_000),
        (10_000_000, 500, 500_000, 10_500_000),
        (1_000_000_000, 200, 20_000_000, 1_020_000_000),
        (1_000_000_000, 500, 50_000_000, 1_050_000_000),
    ] {
        assert_eq!(f.pool.quote_fee(&principal, &bps), (fee, total));
    }
    assert_eq!(
        f.pool.try_quote_fee(&0, &200).err().unwrap(),
        Ok(Error::InvalidAmount)
    );
    for invalid_bps in [0_u32, 1, 199, 201, 499, 501, 10_000] {
        assert_eq!(
            f.pool.try_quote_fee(&1, &invalid_bps).err().unwrap(),
            Ok(Error::InvalidQuote)
        );
    }
    let expected_fee = (u64::MAX as i128) * 500 / 10_000;
    assert_eq!(
        f.pool.quote_fee(&(u64::MAX as i128), &500),
        (expected_fee, (u64::MAX as i128) + expected_fee)
    );
}

#[test]
fn quote_clock_skew_boundary_and_routing_fields_are_enforced() {
    let f = setup();
    let commitment = decode(&f.env, FIX_COMMITMENT);
    let (eph, ct) = dummy_bytes(&f.env);
    let now = f.env.ledger().timestamp();
    let (mut at_boundary, _) = signed_quote(&f, &f.payer, &commitment, 50_000_000, 200);
    at_boundary.issued_at = now + ISSUED_AT_CLOCK_SKEW_SECONDS;
    at_boundary.expires_at = at_boundary.issued_at + 900;
    let digest = f.pool.authorization_digest(&at_boundary);
    let signature = BytesN::from_array(
        &f.env,
        &quote_signing_key().sign(&digest.to_array()).to_bytes(),
    );
    assert!(f
        .pool
        .try_deposit(
            &f.payer,
            &commitment,
            &50_000_000,
            &at_boundary,
            &signature,
            &deposit_proof(&f.env),
            &eph,
            &ct,
        )
        .is_ok());

    for mutation in 0..2 {
        let (mut quote, _) = signed_quote(&f, &f.payer, &commitment, 50_000_000, 200);
        if mutation == 0 {
            quote.issued_at = now + ISSUED_AT_CLOCK_SKEW_SECONDS + 1;
            quote.expires_at = quote.issued_at + 900;
        } else {
            quote.network_id = BytesN::from_array(&f.env, &[99; 32]);
        }
        let digest = f.pool.authorization_digest(&quote);
        let signature = BytesN::from_array(
            &f.env,
            &quote_signing_key().sign(&digest.to_array()).to_bytes(),
        );
        assert!(f
            .pool
            .try_deposit(
                &f.payer,
                &commitment,
                &50_000_000,
                &quote,
                &signature,
                &deposit_proof(&f.env),
                &eph,
                &ct,
            )
            .is_err());
    }
}

#[test]
fn deposit_debits_gross_and_fails_atomically_when_total_is_unavailable() {
    let f = setup();
    let token = token::Client::new(&f.env, &f.asset);
    let drain_to = Address::generate(&f.env);
    let payer_balance = token.balance(&f.payer);
    token.transfer(&f.payer, &drain_to, &(payer_balance - 50_000_000));
    let (eph, ct) = dummy_bytes(&f.env);
    let commitment = decode(&f.env, FIX_COMMITMENT);
    let (quote, signature) = signed_quote(&f, &f.payer, &commitment, 50_000_000, 200);

    assert!(f
        .pool
        .try_deposit(
            &f.payer,
            &commitment,
            &50_000_000,
            &quote,
            &signature,
            &deposit_proof(&f.env),
            &eph,
            &ct,
        )
        .is_err());
    assert_eq!(token.balance(&f.payer), 50_000_000);
    assert_eq!(token.balance(&f.pool.address), 0);
    assert_eq!(token.balance(&f.fee_recipient), 0);
    assert_eq!(f.pool.leaf_count(), 0);
    assert!(!f.pool.is_quote_used(&quote.quote_id));
}

#[test]
fn signed_special_tier_settles_five_percent_and_replay_is_rejected() {
    let f = setup();
    let token = token::Client::new(&f.env, &f.asset);
    let commitment = decode(&f.env, FIX_COMMITMENT);
    let (eph, ct) = dummy_bytes(&f.env);
    let (quote, signature) = signed_quote(&f, &f.payer, &commitment, 50_000_000, 500);
    let payer_before = token.balance(&f.payer);

    f.pool.deposit(
        &f.payer,
        &commitment,
        &50_000_000,
        &quote,
        &signature,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(token.balance(&f.payer), payer_before - 52_500_000);
    assert_eq!(token.balance(&f.pool.address), 50_000_000);
    assert_eq!(token.balance(&f.fee_recipient), 2_500_000);
    assert!(f.pool.is_quote_used(&quote.quote_id));

    assert_eq!(
        f.pool
            .try_deposit(
                &f.payer,
                &commitment,
                &50_000_000,
                &quote,
                &signature,
                &deposit_proof(&f.env),
                &eph,
                &ct,
            )
            .err()
            .unwrap(),
        Ok(Error::QuoteAlreadyUsed),
    );
    assert_eq!(f.pool.leaf_count(), 1);
}

#[test]
fn altered_and_expired_quotes_fail_before_value_moves() {
    let f = setup();
    let token = token::Client::new(&f.env, &f.asset);
    let commitment = decode(&f.env, FIX_COMMITMENT);
    let (eph, ct) = dummy_bytes(&f.env);
    let (mut quote, signature) = signed_quote(&f, &f.payer, &commitment, 50_000_000, 200);
    let payer_before = token.balance(&f.payer);

    quote.total_amount += 1;
    assert_eq!(
        f.pool
            .try_deposit(
                &f.payer,
                &commitment,
                &50_000_000,
                &quote,
                &signature,
                &deposit_proof(&f.env),
                &eph,
                &ct,
            )
            .err()
            .unwrap(),
        Ok(Error::InvalidQuote),
    );

    let (mut expired, _) = signed_quote(&f, &f.payer, &commitment, 50_000_000, 200);
    expired.expires_at = expired.issued_at + 1;
    let digest = f.pool.authorization_digest(&expired);
    let expired_signature = BytesN::from_array(
        &f.env,
        &quote_signing_key().sign(&digest.to_array()).to_bytes(),
    );
    f.env.ledger().set_timestamp(expired.expires_at + 1);
    assert_eq!(
        f.pool
            .try_deposit(
                &f.payer,
                &commitment,
                &50_000_000,
                &expired,
                &expired_signature,
                &deposit_proof(&f.env),
                &eph,
                &ct,
            )
            .err()
            .unwrap(),
        Ok(Error::QuoteExpired),
    );
    assert_eq!(token.balance(&f.payer), payer_before);
    assert_eq!(token.balance(&f.pool.address), 0);
    assert_eq!(f.pool.leaf_count(), 0);
}

#[test]
fn fee_quote_signer_rotation_is_timelocked() {
    let f = setup();
    let replacement = SigningKey::from_bytes(&[8; 32]);
    let replacement_public = BytesN::from_array(&f.env, &replacement.verifying_key().to_bytes());
    let original = f.pool.fee_config().signer;
    let proposal = f.pool.propose_fee_quote_signer(&replacement_public);
    let execute_at = f.pool.pending_governance().unwrap().execute_at;
    assert_eq!(f.pool.fee_config().signer, original);
    f.env.ledger().set_timestamp(execute_at);
    f.env.set_auths(&[]);
    f.pool.execute_governance(&proposal);
    assert_eq!(f.pool.fee_config().signer, replacement_public);
}

#[test]
fn fee_recipient_rotation_is_timelocked() {
    let f = setup();
    let replacement = Address::generate(&f.env);
    assert_eq!(f.pool.fee_recipient(), f.fee_recipient);
    let proposal_id = f.pool.propose_fee_recipient(&replacement);
    let execute_at = f.pool.pending_governance().unwrap().execute_at;
    assert_eq!(f.pool.fee_recipient(), f.fee_recipient);
    f.env.ledger().set_timestamp(execute_at - 1);
    assert_eq!(
        f.pool.try_execute_governance(&proposal_id).err().unwrap(),
        Ok(Error::TimelockNotElapsed)
    );
    f.env.ledger().set_timestamp(execute_at);
    f.env.set_auths(&[]);
    f.pool.execute_governance(&proposal_id);
    assert_eq!(f.pool.fee_recipient(), replacement);
}

#[test]
fn deposit_rejects_commitment_not_bound_to_amount_atomically() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let token = token::Client::new(&f.env, &f.asset);
    let payer_before = token.balance(&f.payer);
    let commitment = decode(&f.env, FIX_COMMITMENT);
    let (quote, signature) = signed_quote(&f, &f.payer, &commitment, 1, 200);

    let err = f
        .pool
        .try_deposit(
            &f.payer,
            &commitment,
            &1,
            &quote,
            &signature,
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
    let commitment = decode(&f.env, FIX_COMMITMENT);
    let quote = raw_quote(&f, &f.payer, &commitment, (u64::MAX as i128) + 1, 200, 0, 0);
    let signature = BytesN::from_array(&f.env, &[0; 64]);
    let err = f
        .pool
        .try_deposit(
            &f.payer,
            &commitment,
            &((u64::MAX as i128) + 1),
            &quote,
            &signature,
            &deposit_proof(&f.env),
            &eph,
            &ct,
        )
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::InvalidAmount));
}

#[test]
fn withdraw_full_flow() {
    use super::withdraw_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let token = token::Client::new(&f.env, &f.asset);

    deposit(
        &f,
        &f.payer,
        &decode::<32>(&f.env, WD_COMMITMENT),
        WD_AMOUNT,
        &wd_deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, WD_ROOT));
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
fn transfer_is_disabled_without_spending_the_input() {
    use super::transfer_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    let token = token::Client::new(&f.env, &f.asset);

    deposit(
        &f,
        &f.payer,
        &decode::<32>(&f.env, TR_IN_COMMITMENT),
        TR_IN_AMOUNT,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    assert_eq!(f.pool.current_root(), decode::<32>(&f.env, TR_ROOT));
    assert_eq!(token.balance(&f.pool.address), TR_IN_AMOUNT);

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
    assert_eq!(err, Ok(Error::TransferDisabled));
    assert_eq!(f.pool.leaf_count(), 1);
    assert!(!f.pool.is_spent(&nullifier));
    assert_eq!(token.balance(&f.pool.address), TR_IN_AMOUNT);
}

#[test]
fn withdraw_unknown_root_rejected() {
    let f = setup();
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
fn pause_blocks_deposit_and_transfer_but_not_withdrawal() {
    use super::withdraw_fixture::*;
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);

    deposit(
        &f,
        &f.payer,
        &decode::<32>(&f.env, WD_COMMITMENT),
        WD_AMOUNT,
        &wd_deposit_proof(&f.env),
        &eph,
        &ct,
    );
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
    let paused_quote = raw_quote(&f, &f.payer, &nullifier, 1, 200, 0, 1);
    let paused_signature = BytesN::from_array(&f.env, &[0; 64]);

    assert_eq!(
        f.pool
            .try_deposit(
                &f.payer,
                &nullifier,
                &1,
                &paused_quote,
                &paused_signature,
                &proof,
                &nullifier,
                &ct,
            )
            .err()
            .unwrap(),
        Ok(Error::Paused)
    );
    f.pool
        .withdraw(&recipient, &WD_AMOUNT, &root, &nullifier, &proof);
    assert_eq!(
        f.pool
            .try_transfer(
                &root, &nullifier, &proof, &nullifier, &nullifier, &ct, &nullifier, &nullifier, &ct
            )
            .err()
            .unwrap(),
        Ok(Error::Paused)
    );

    let token = token::Client::new(&f.env, &f.asset);
    assert_eq!(token.balance(&Address::from_string(&recipient)), WD_AMOUNT);
    f.pool.unpause();
    assert!(!f.pool.is_paused());
    deposit(
        &f,
        &f.payer,
        &decode::<32>(&f.env, FIX_COMMITMENT),
        50_000_000,
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
fn constructor_stores_all_verifier_keys_atomically() {
    let f = setup();
    assert!(f.pool.has_deposit_verifier_key());
    assert!(f.pool.has_verifier_key());
    assert!(f.pool.has_transfer_verifier_key());
    assert_eq!(stored_vk(&f, &VerifierKind::Deposit), deposit_vk(&f.env));
    assert_eq!(stored_vk(&f, &VerifierKind::Withdraw), fixture_vk(&f.env));
    assert_eq!(stored_vk(&f, &VerifierKind::Transfer), transfer_vk(&f.env));
}

#[test]
#[should_panic]
fn constructor_rejects_invalid_verifier_key() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let fee_recipient = Address::generate(&env);
    env.register(
        PoolContract,
        (
            admin,
            asset,
            fee_recipient,
            20u32,
            fixture_vk(&env),
            fixture_vk(&env),
            transfer_vk(&env),
        ),
    );
}

#[test]
fn governance_proposal_authorization_serialization_and_cancellation() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    let hash = BytesN::from_array(&f.env, &[7u8; 32]);

    f.env.set_auths(&[]);
    assert!(f.pool.try_propose_upgrade(&hash).is_err());
    assert!(f.pool.try_propose_admin(&new_admin).is_err());
    assert!(f
        .pool
        .try_propose_verifier_key(&VerifierKind::Withdraw, &fixture_vk(&f.env))
        .is_err());

    f.env.mock_all_auths();
    let proposal_id = f.pool.propose_admin(&new_admin);
    let pending = f.pool.pending_governance().unwrap();
    assert_eq!(proposal_id, 1);
    assert_eq!(pending.proposal_id, proposal_id);
    assert_eq!(pending.proposed_at, f.env.ledger().timestamp());
    assert_eq!(pending.execute_at, pending.proposed_at + TIMELOCK_SECONDS);
    assert_eq!(
        pending.payload_hash,
        f.env
            .crypto()
            .sha256(&GovernanceAction::SetAdmin(new_admin).to_xdr(&f.env))
            .to_bytes()
    );
    assert_eq!(
        f.pool.try_propose_upgrade(&hash).err().unwrap(),
        Ok(Error::ProposalAlreadyPending)
    );
    assert_eq!(
        f.pool
            .try_cancel_governance(&(proposal_id + 1))
            .err()
            .unwrap(),
        Ok(Error::ProposalIdMismatch)
    );

    f.env.set_auths(&[]);
    assert!(f.pool.try_cancel_governance(&proposal_id).is_err());
    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "cancel_governance",
            args: (proposal_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.pool.cancel_governance(&proposal_id);
    assert_eq!(f.pool.pending_governance(), None);
    f.env.mock_all_auths();
    assert_eq!(
        f.pool.try_cancel_governance(&proposal_id).err().unwrap(),
        Ok(Error::NoPendingProposal)
    );
    assert_eq!(
        f.pool.try_execute_governance(&proposal_id).err().unwrap(),
        Ok(Error::NoPendingProposal)
    );

    f.env.mock_all_auths();
    assert_eq!(f.pool.propose_upgrade(&hash), 2);
}

#[test]
fn verifier_change_is_delayed_and_permissionlessly_executed_at_deadline() {
    let f = setup();
    let previous_vk = stored_vk(&f, &VerifierKind::Withdraw);
    let replacement_vk = transfer_vk(&f.env);
    let proposal_id = f
        .pool
        .propose_verifier_key(&VerifierKind::Withdraw, &replacement_vk);
    let pending = f.pool.pending_governance().unwrap();

    assert_eq!(stored_vk(&f, &VerifierKind::Withdraw), previous_vk);
    assert_eq!(f.pool.admin(), f.admin);
    assert_eq!(
        f.pool
            .try_execute_governance(&(proposal_id + 1))
            .err()
            .unwrap(),
        Ok(Error::ProposalIdMismatch)
    );

    f.env.ledger().set_timestamp(pending.execute_at - 1);
    f.env.set_auths(&[]);
    assert_eq!(
        f.pool.try_execute_governance(&proposal_id).err().unwrap(),
        Ok(Error::TimelockNotElapsed)
    );
    assert_eq!(stored_vk(&f, &VerifierKind::Withdraw), previous_vk);

    f.env.ledger().set_timestamp(pending.execute_at);
    f.pool.execute_governance(&proposal_id);
    assert_eq!(stored_vk(&f, &VerifierKind::Withdraw), replacement_vk);
    assert_eq!(f.pool.pending_governance(), None);
    assert_eq!(
        f.pool.try_execute_governance(&proposal_id).err().unwrap(),
        Ok(Error::NoPendingProposal)
    );
}

#[test]
fn verifier_keys_change_only_after_execution_for_each_kind() {
    let f = setup();
    let cases = [
        (VerifierKind::Deposit, deposit_vk(&f.env)),
        (VerifierKind::Withdraw, fixture_vk(&f.env)),
        (VerifierKind::Transfer, transfer_vk(&f.env)),
    ];
    for (kind, mut replacement) in cases {
        let previous = stored_vk(&f, &kind);
        replacement.alpha = previous.ic.get(0).unwrap();
        let proposal_id = f.pool.propose_verifier_key(&kind, &replacement);
        assert_eq!(stored_vk(&f, &kind), previous);
        let execute_at = f.pool.pending_governance().unwrap().execute_at;
        f.env.ledger().set_timestamp(execute_at);
        f.env.set_auths(&[]);
        f.pool.execute_governance(&proposal_id);
        assert_eq!(stored_vk(&f, &kind), replacement);
        f.env.mock_all_auths();
    }
}

#[test]
fn invalid_verifier_keys_are_rejected_before_storage() {
    let f = setup();
    assert_eq!(
        f.pool
            .try_propose_verifier_key(&VerifierKind::Deposit, &fixture_vk(&f.env))
            .err()
            .unwrap(),
        Ok(Error::InvalidVerifierKey)
    );
    assert_eq!(
        f.pool
            .try_propose_verifier_key(&VerifierKind::Withdraw, &deposit_vk(&f.env))
            .err()
            .unwrap(),
        Ok(Error::InvalidVerifierKey)
    );
    assert_eq!(
        f.pool
            .try_propose_verifier_key(&VerifierKind::Transfer, &deposit_vk(&f.env))
            .err()
            .unwrap(),
        Ok(Error::InvalidVerifierKey)
    );
    assert_eq!(f.pool.pending_governance(), None);
}

#[test]
fn admin_rotation_requires_new_admin_and_replaces_authority() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    let proposal_id = f.pool.propose_admin(&new_admin);
    let execute_at = f.pool.pending_governance().unwrap().execute_at;
    assert_eq!(f.pool.admin(), f.admin);
    f.env.ledger().set_timestamp(execute_at);

    f.env.set_auths(&[]);
    assert!(f.pool.try_execute_governance(&proposal_id).is_err());
    assert!(f.pool.pending_governance().is_some());

    f.env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "execute_governance",
            args: (proposal_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.pool.execute_governance(&proposal_id);
    assert_eq!(f.pool.admin(), new_admin);

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

    let hash = BytesN::from_array(&f.env, &[8u8; 32]);
    f.env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "propose_upgrade",
            args: (hash.clone(),).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    let next_id = f.pool.propose_upgrade(&hash);

    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "cancel_governance",
            args: (next_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.pool.try_cancel_governance(&next_id).is_err());
    f.env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &MockAuthInvoke {
            contract: &f.pool.address,
            fn_name: "cancel_governance",
            args: (next_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.pool.cancel_governance(&next_id);
}

#[test]
fn pending_governance_read_extends_instance_ttl() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    f.pool.propose_admin(&new_admin);
    f.env
        .ledger()
        .set_sequence_number(TTL_EXTEND - TTL_THRESHOLD + 2);
    let before = f
        .env
        .as_contract(&f.pool.address, || f.env.storage().instance().get_ttl());
    assert!(before < TTL_THRESHOLD);
    assert!(f.pool.pending_governance().is_some());
    let after = f
        .env
        .as_contract(&f.pool.address, || f.env.storage().instance().get_ttl());
    assert_eq!(after, TTL_EXTEND);
}

#[test]
fn proposal_rejects_timestamp_overflow() {
    let f = setup();
    f.env
        .ledger()
        .set_timestamp(u64::MAX - TIMELOCK_SECONDS + 1);
    let hash = BytesN::from_array(&f.env, &[9u8; 32]);
    assert_eq!(
        f.pool.try_propose_upgrade(&hash).err().unwrap(),
        Ok(Error::TimestampOverflow)
    );
    assert_eq!(f.pool.pending_governance(), None);
}

#[test]
fn permissionless_upgrade_preserves_pool_state() {
    let f = setup();
    let (eph, ct) = dummy_bytes(&f.env);
    deposit(
        &f,
        &f.payer,
        &decode::<32>(&f.env, FIX_COMMITMENT),
        50_000_000,
        &deposit_proof(&f.env),
        &eph,
        &ct,
    );
    f.pool.pause();
    let nullifier = BytesN::from_array(&f.env, &[4u8; 32]);
    f.env.as_contract(&f.pool.address, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::Nullifier(nullifier.clone()), &true);
    });
    let config = f.pool.get_config();
    let root = f.pool.current_root();
    let deposit_key = stored_vk(&f, &VerifierKind::Deposit);
    let withdraw_key = stored_vk(&f, &VerifierKind::Withdraw);
    let transfer_key = stored_vk(&f, &VerifierKind::Transfer);
    let wasm = Bytes::from_slice(&f.env, &hex_to_vec(UPGRADE_WASM_HEX));
    let wasm_hash = f.env.deployer().upload_contract_wasm(wasm);
    let proposal_id = f.pool.propose_upgrade(&wasm_hash);
    let execute_at = f.pool.pending_governance().unwrap().execute_at;
    f.env.ledger().set_timestamp(execute_at);
    f.env.set_auths(&[]);
    f.pool.execute_governance(&proposal_id);

    f.env.as_contract(&f.pool.address, || {
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, Address>(&DataKey::Admin),
            Some(f.admin.clone())
        );
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, super::Config>(&DataKey::Config),
            Some(config)
        );
        assert_eq!(
            f.env.storage().instance().get::<_, bool>(&DataKey::Paused),
            Some(true)
        );
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, VerificationKey>(&DataKey::VkDeposit),
            Some(deposit_key)
        );
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, VerificationKey>(&DataKey::Vk),
            Some(withdraw_key)
        );
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, VerificationKey>(&DataKey::VkTransfer),
            Some(transfer_key)
        );
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, Vec<BytesN<32>>>(&DataKey::Roots)
                .unwrap()
                .last(),
            Some(root)
        );
        assert_eq!(
            f.env
                .storage()
                .instance()
                .get::<_, u32>(&DataKey::NextIndex),
            Some(1)
        );
        assert!(f
            .env
            .storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier.clone())));
        assert!(!f.env.storage().instance().has(&DataKey::PendingGovernance));
    });
    assert_eq!(
        token::Client::new(&f.env, &f.asset).balance(&f.pool.address),
        50_000_000
    );
}

fn stored_vk(f: &Fx<'_>, kind: &VerifierKind) -> VerificationKey {
    let key = match kind {
        VerifierKind::Deposit => DataKey::VkDeposit,
        VerifierKind::Withdraw => DataKey::Vk,
        VerifierKind::Transfer => DataKey::VkTransfer,
    };
    f.env.as_contract(&f.pool.address, || {
        f.env.storage().instance().get(&key).unwrap()
    })
}
