#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    Bytes, BytesN, Env, Vec,
};

const TTL_THRESHOLD: u32 = 30 * 17_280;
const TTL_EXTEND: u32 = 120 * 17_280;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Ed25519Signature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
enum DataKey {
    Owner,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidSignatureCount = 3,
    WrongSigner = 4,
}

#[contract]
pub struct OlioAccount;

fn extend_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

fn stored_owner(env: &Env) -> Result<BytesN<32>, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or(Error::NotInitialized)
}

#[contractimpl]
impl OlioAccount {
    pub fn __constructor(env: Env, owner: BytesN<32>) -> Result<(), Error> {
        let store = env.storage().instance();
        if store.has(&DataKey::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        store.set(&DataKey::Owner, &owner);
        extend_ttl(&env);
        Ok(())
    }

    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        stored_owner(&env)
    }

    pub fn set_owner(env: Env, new_owner: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        env.storage().instance().set(&DataKey::Owner, &new_owner);
        extend_ttl(&env);
        Ok(())
    }

    pub fn update_contract_code(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        extend_ttl(&env);
        env.deployer().update_current_contract_wasm(wasm_hash);
        Ok(())
    }
}

#[contractimpl]
impl CustomAccountInterface for OlioAccount {
    type Signature = Vec<Ed25519Signature>;
    type Error = Error;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Ed25519Signature>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        if signatures.len() != 1 {
            return Err(Error::InvalidSignatureCount);
        }
        let signature = signatures.get(0).unwrap();
        if signature.public_key != stored_owner(&env)? {
            return Err(Error::WrongSigner);
        }
        let payload = Bytes::from(signature_payload);
        env.crypto().ed25519_verify(
            &signature.public_key,
            &payload,
            &signature.signature,
        );
        extend_ttl(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
