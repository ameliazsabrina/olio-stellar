extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Deployer as _, Ledger},
    vec, Address, BytesN, Env, IntoVal,
};

fn signing_key(byte: u8) -> SigningKey {
    SigningKey::from_bytes(&[byte; 32])
}

fn account<'a>(env: &'a Env, key: &SigningKey) -> (Address, OlioAccountClient<'a>) {
    let id = env.register(
        OlioAccount,
        (BytesN::from_array(env, &key.verifying_key().to_bytes()),),
    );
    (id.clone(), OlioAccountClient::new(env, &id))
}

fn signature(env: &Env, key: &SigningKey, payload: &[u8; 32]) -> Ed25519Signature {
    Ed25519Signature {
        public_key: BytesN::from_array(env, &key.verifying_key().to_bytes()),
        signature: BytesN::from_array(env, &key.sign(payload).to_bytes()),
    }
}

#[test]
fn construction_and_owner() {
    let env = Env::default();
    let key = signing_key(7);
    let (_, client) = account(&env, &key);
    assert_eq!(
        client.owner(),
        BytesN::from_array(&env, &key.verifying_key().to_bytes())
    );
}

#[test]
fn rejects_reinitialization() {
    let env = Env::default();
    let key = signing_key(1);
    let (id, _) = account(&env, &key);
    let owner = BytesN::from_array(&env, &key.verifying_key().to_bytes());
    env.as_contract(&id, || {
        assert_eq!(
            OlioAccount::__constructor(env.clone(), owner),
            Err(Error::AlreadyInitialized)
        );
    });
}

#[test]
fn rejects_wrong_key_and_signature_cardinality() {
    let env = Env::default();
    let owner = signing_key(7);
    let wrong = signing_key(8);
    let (id, _) = account(&env, &owner);
    let payload = [3; 32];

    assert_eq!(
        env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            Vec::<Ed25519Signature>::new(&env).into_val(&env),
            &vec![&env],
        ),
        Err(Ok(Error::InvalidSignatureCount))
    );
    assert_eq!(
        env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            vec![&env, signature(&env, &wrong, &payload)].into_val(&env),
            &vec![&env],
        ),
        Err(Ok(Error::WrongSigner))
    );
    assert_eq!(
        env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            vec![
                &env,
                signature(&env, &owner, &payload),
                signature(&env, &owner, &payload)
            ]
            .into_val(&env),
            &vec![&env],
        ),
        Err(Ok(Error::InvalidSignatureCount))
    );
}

#[test]
fn accepts_standard_ed25519_signature_struct_and_extends_ttl() {
    let env = Env::default();
    env.ledger().set_sequence_number(100);
    let owner = signing_key(9);
    let (id, _) = account(&env, &owner);
    let payload = [5; 32];
    let signatures = vec![&env, signature(&env, &owner, &payload)];

    assert_eq!(
        env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            signatures.into_val(&env),
            &vec![&env],
        ),
        Ok(())
    );
    assert!(env.deployer().get_contract_instance_ttl(&id) >= TTL_EXTEND - 1);
}

#[test]
fn invalid_signature_is_rejected() {
    let env = Env::default();
    let owner = signing_key(10);
    let (id, _) = account(&env, &owner);
    let payload = [6; 32];
    let signatures = vec![&env, signature(&env, &owner, &[7; 32])];

    assert!(env
        .try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            signatures.into_val(&env),
            &vec![&env],
        )
        .is_err());
}

#[test]
fn owner_rotation_requires_account_auth() {
    let env = Env::default();
    let owner = signing_key(11);
    let next = signing_key(12);
    let (_, client) = account(&env, &owner);
    let next_key = BytesN::from_array(&env, &next.verifying_key().to_bytes());
    let wasm_hash = BytesN::from_array(&env, &[4; 32]);
    assert!(client.try_set_owner(&next_key).is_err());
    assert!(client.try_update_contract_code(&wasm_hash).is_err());

    env.mock_all_auths();
    client.set_owner(&next_key);
    assert_eq!(client.owner(), next_key);
}
