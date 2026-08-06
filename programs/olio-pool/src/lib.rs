#![no_std]


use soroban_poseidon::poseidon_hash;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contractmeta, contracttype,
    crypto::bn254::Bn254Fr, panic_with_error, symbol_short, token, vec, Address, Bytes, BytesN,
    Env, String, Vec, U256,
};

contractmeta!(key = "binver", val = "2.0.0");

mod groth16;
pub use groth16::{Proof, VerificationKey};

#[cfg(test)]
mod fixture;
#[cfg(test)]
mod deposit_fixture;
#[cfg(test)]
mod test;
#[cfg(test)]
mod transfer_fixture;
#[cfg(test)]
mod withdraw_fixture;

const ROOT_HISTORY_SIZE: u32 = 30;
const MAX_DEPTH: u32 = 32;
const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = DAY_LEDGERS * 30;
const TTL_EXTEND: u32 = DAY_LEDGERS * 90;

const BN254_FR_ORDER: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub asset: Address,
    pub depth: u32,
}

#[contracttype]
enum DataKey {
    Config,
    Admin,
    PendingAdmin,
    Paused,
    VkDeposit,
    Vk,
    VkTransfer,
    Zeros,
    Filled,
    NextIndex,
    Roots,
    Nullifier(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidDepth = 3,
    InvalidAmount = 4,
    TreeFull = 5,
    UnknownRoot = 6,
    DoubleSpend = 7,
    VerifierKeyNotSet = 8,
    InvalidProof = 9,
    Paused = 10,
    AdminTransferNotPending = 11,
    InvalidFieldElement = 12,
}

#[contractevent(topics = ["pause"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseEvent {
    pub admin: Address,
}

#[contractevent(topics = ["unpause"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnpauseEvent {
    pub admin: Address,
}

#[contractevent(topics = ["upgrade"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeEvent {
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent(topics = ["admin_proposed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposedEvent {
    pub admin: Address,
    pub pending_admin: Address,
}

#[contractevent(topics = ["admin_cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminCancelledEvent {
    pub admin: Address,
    pub pending_admin: Address,
}

#[contractevent(topics = ["admin_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    pub previous_admin: Address,
    pub new_admin: Address,
}

#[contract]
pub struct PoolContract;

#[contractimpl]
impl PoolContract {
    pub fn __constructor(env: Env, admin: Address, asset: Address, depth: u32) {
        let store = env.storage().instance();
        if depth == 0 || depth > MAX_DEPTH {
            panic_with_error!(&env, Error::InvalidDepth);
        }

        let mut zeros = Vec::new(&env);
        let mut z = U256::from_u32(&env, 0);
        zeros.push_back(z.clone());
        let mut filled = Vec::new(&env);
        for _ in 0..depth {
            filled.push_back(z.clone());
            z = hash_pair(&env, &z, &z);
            zeros.push_back(z.clone());
        }
        let mut roots = Vec::new(&env);
        roots.push_back(to_bytes32(&env, &z));

        store.set(&DataKey::Config, &Config { asset, depth });
        store.set(&DataKey::Admin, &admin);
        store.set(&DataKey::Paused, &false);
        store.set(&DataKey::Zeros, &zeros);
        store.set(&DataKey::Filled, &filled);
        store.set(&DataKey::NextIndex, &0u32);
        store.set(&DataKey::Roots, &roots);
        store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
    }

    pub fn set_verifier_key(env: Env, vk: VerificationKey) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::Vk, &vk);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(())
    }

    pub fn set_deposit_verifier_key(env: Env, vk: VerificationKey) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::VkDeposit, &vk);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(())
    }

    pub fn set_transfer_verifier_key(env: Env, vk: VerificationKey) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::VkTransfer, &vk);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(())
    }

    pub fn deposit(
        env: Env,
        from: Address,
        commitment: BytesN<32>,
        amount: i128,
        proof: Proof,
        ephemeral_pk: BytesN<32>,
        ciphertext: Bytes,
    ) -> Result<u32, Error> {
        from.require_auth();
        require_not_paused(&env)?;
        if amount <= 0 || amount > u64::MAX as i128 {
            return Err(Error::InvalidAmount);
        }
        let commitment_field = to_u256(&env, &commitment);
        if commitment_field >= bn254_fr_order(&env) {
            return Err(Error::InvalidFieldElement);
        }
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkDeposit)
            .ok_or(Error::VerifierKeyNotSet)?;
        let signals = vec![
            &env,
            Bn254Fr::from_u256(commitment_field.clone()),
            Bn254Fr::from_u256(U256::from_u128(&env, amount as u128)),
        ];
        if !groth16::verify(&env, &vk, &proof, &signals) {
            return Err(Error::InvalidProof);
        }
        let config = load_config(&env)?;
        token::Client::new(&env, &config.asset).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        let leaf_index = insert(&env, &config, &commitment_field)?;

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        env.events().publish(
            (symbol_short!("deposit"),),
            (leaf_index, commitment, ephemeral_pk, ciphertext),
        );
        Ok(leaf_index)
    }

    pub fn withdraw(
        env: Env,
        recipient: String,
        amount: i128,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let config = load_config(&env)?;
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::Vk)
            .ok_or(Error::VerifierKeyNotSet)?;

        if !root_is_known(&env, &root) {
            return Err(Error::UnknownRoot);
        }
        let store = env.storage().persistent();
        if store.has(&DataKey::Nullifier(nullifier.clone())) {
            return Err(Error::DoubleSpend);
        }

        let recipient_fr = recipient_to_field(&env, &recipient);
        let signals = vec![
            &env,
            Bn254Fr::from_u256(to_u256(&env, &root)),
            Bn254Fr::from_u256(to_u256(&env, &nullifier)),
            Bn254Fr::from_u256(recipient_fr),
            Bn254Fr::from_u256(U256::from_u128(&env, amount as u128)),
        ];
        if !groth16::verify(&env, &vk, &proof, &signals) {
            return Err(Error::InvalidProof);
        }

        store.set(&DataKey::Nullifier(nullifier.clone()), &true);
        store.extend_ttl(
            &DataKey::Nullifier(nullifier.clone()),
            TTL_THRESHOLD,
            TTL_EXTEND,
        );

        let dest = Address::from_string(&recipient);
        token::Client::new(&env, &config.asset).transfer(
            &env.current_contract_address(),
            &dest,
            &amount,
        );
        env.events().publish(
            (symbol_short!("withdraw"),),
            (nullifier.clone(), dest, amount),
        );
        env.events().publish((symbol_short!("spend"),), nullifier);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn transfer(
        env: Env,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Proof,
        recipient_commitment: BytesN<32>,
        recipient_ephemeral_pk: BytesN<32>,
        recipient_ciphertext: Bytes,
        change_commitment: BytesN<32>,
        change_ephemeral_pk: BytesN<32>,
        change_ciphertext: Bytes,
    ) -> Result<(u32, u32), Error> {
        require_not_paused(&env)?;
        let config = load_config(&env)?;
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkTransfer)
            .ok_or(Error::VerifierKeyNotSet)?;

        if !root_is_known(&env, &root) {
            return Err(Error::UnknownRoot);
        }
        let store = env.storage().persistent();
        if store.has(&DataKey::Nullifier(nullifier.clone())) {
            return Err(Error::DoubleSpend);
        }

        let signals = vec![
            &env,
            Bn254Fr::from_u256(to_u256(&env, &root)),
            Bn254Fr::from_u256(to_u256(&env, &nullifier)),
            Bn254Fr::from_u256(to_u256(&env, &recipient_commitment)),
            Bn254Fr::from_u256(to_u256(&env, &change_commitment)),
        ];
        if !groth16::verify(&env, &vk, &proof, &signals) {
            return Err(Error::InvalidProof);
        }

        store.set(&DataKey::Nullifier(nullifier.clone()), &true);
        store.extend_ttl(
            &DataKey::Nullifier(nullifier.clone()),
            TTL_THRESHOLD,
            TTL_EXTEND,
        );

        let recipient_leaf = to_u256(&env, &recipient_commitment);
        let recipient_index = insert(&env, &config, &recipient_leaf)?;
        let change_leaf = to_u256(&env, &change_commitment);
        let change_index = insert(&env, &config, &change_leaf)?;

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        env.events().publish(
            (symbol_short!("deposit"),),
            (
                recipient_index,
                recipient_commitment,
                recipient_ephemeral_pk,
                recipient_ciphertext,
            ),
        );
        env.events().publish(
            (symbol_short!("deposit"),),
            (
                change_index,
                change_commitment,
                change_ephemeral_pk,
                change_ciphertext,
            ),
        );
        env.events().publish((symbol_short!("spend"),), nullifier);
        Ok((recipient_index, change_index))
    }


    pub fn get_config(env: Env) -> Result<Config, Error> {
        load_config(&env)
    }

    pub fn current_root(env: Env) -> Result<BytesN<32>, Error> {
        load_config(&env)?;
        let roots: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::Roots).unwrap();
        Ok(roots.last().unwrap())
    }

    pub fn leaf_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::NextIndex)
            .unwrap_or(0)
    }

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    pub fn has_verifier_key(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Vk)
    }

    pub fn has_deposit_verifier_key(env: Env) -> bool {
        env.storage().instance().has(&DataKey::VkDeposit)
    }

    pub fn has_transfer_verifier_key(env: Env) -> bool {
        env.storage().instance().has(&DataKey::VkTransfer)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }


    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        PauseEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        UnpauseEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        UpgradeEvent {
            admin,
            new_wasm_hash: new_wasm_hash.clone(),
        }
        .publish(&env);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        AdminProposedEvent {
            admin,
            pending_admin: new_admin,
        }
        .publish(&env);
        Ok(())
    }

    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::AdminTransferNotPending)?;
        pending_admin.require_auth();
        let previous_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        env.storage()
            .instance()
            .set(&DataKey::Admin, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        AdminChangedEvent {
            previous_admin,
            new_admin: pending_admin,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_admin_transfer(env: Env) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::AdminTransferNotPending)?;
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        AdminCancelledEvent {
            admin,
            pending_admin,
        }
        .publish(&env);
        Ok(())
    }
}


fn load_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn require_admin(env: &Env) -> Result<Address, Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    admin.require_auth();
    Ok(admin)
}

fn require_not_paused(env: &Env) -> Result<(), Error> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        return Err(Error::Paused);
    }
    Ok(())
}

fn hash_pair(env: &Env, left: &U256, right: &U256) -> U256 {
    poseidon_hash::<3, Bn254Fr>(env, &vec![env, left.clone(), right.clone()])
}

fn bn254_fr_order(env: &Env) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &BN254_FR_ORDER))
}

fn to_u256(env: &Env, b: &BytesN<32>) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &b.to_array()))
}

fn to_bytes32(env: &Env, u: &U256) -> BytesN<32> {
    let bytes = u.to_be_bytes();
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    BytesN::from_array(env, &arr)
}

fn recipient_to_field(env: &Env, recipient: &String) -> U256 {
    let hash = env.crypto().keccak256(&recipient.to_bytes());
    let order = bn254_fr_order(env);
    U256::from_be_bytes(env, &Bytes::from_array(env, &hash.to_bytes().to_array()))
        .rem_euclid(&order)
}

fn root_is_known(env: &Env, root: &BytesN<32>) -> bool {
    let roots: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::Roots).unwrap();
    roots.iter().any(|r| &r == root)
}

fn insert(env: &Env, config: &Config, leaf: &U256) -> Result<u32, Error> {
    let store = env.storage().instance();
    let next_index: u32 = store.get(&DataKey::NextIndex).unwrap();
    if config.depth < 32 && next_index >= 1u32.checked_shl(config.depth).unwrap_or(u32::MAX) {
        return Err(Error::TreeFull);
    }

    let zeros: Vec<U256> = store.get(&DataKey::Zeros).unwrap();
    let mut filled: Vec<U256> = store.get(&DataKey::Filled).unwrap();

    let mut current = leaf.clone();
    let mut idx = next_index;
    for i in 0..config.depth {
        let (left, right) = if idx & 1 == 0 {
            filled.set(i, current.clone());
            (current.clone(), zeros.get(i).unwrap())
        } else {
            (filled.get(i).unwrap(), current.clone())
        };
        current = hash_pair(env, &left, &right);
        idx >>= 1;
    }

    let mut roots: Vec<BytesN<32>> = store.get(&DataKey::Roots).unwrap();
    roots.push_back(to_bytes32(env, &current));
    while roots.len() > ROOT_HISTORY_SIZE {
        roots.remove(0);
    }

    store.set(&DataKey::Filled, &filled);
    store.set(&DataKey::Roots, &roots);
    store.set(&DataKey::NextIndex, &(next_index + 1));
    Ok(next_index)
}
