extern crate std;

use super::fixture::*;
use super::groth16::{verify, Proof, VerificationKey};
use super::{
    DataKey, Error, GovernanceAction, PoolContract, PoolContractClient, VerifierKind,
    TIMELOCK_SECONDS, TTL_EXTEND, TTL_THRESHOLD,
};
use soroban_sdk::{
    crypto::bn254::Bn254Fr,
    symbol_short,
    testutils::{
        storage::Instance as _, Address as _, Events as _, Ledger, MockAuth, MockAuthInvoke,
    },
    token,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, IntoVal, String, Vec, U256,
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
    let id = env.register(
        PoolContract,
        (
            admin.clone(),
            asset.clone(),
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
    env.register(
        PoolContract,
        (
            admin,
            asset,
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
    env.register(
        PoolContract,
        (
            admin,
            asset,
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
    f.pool.deposit(
        &f.payer,
        &decode::<32>(&f.env, FIX_COMMITMENT),
        &50_000_000,
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
