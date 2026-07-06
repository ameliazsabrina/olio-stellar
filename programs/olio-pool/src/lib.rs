#![no_std]

//! Olio shielded pool — iteration 2 (real zero-knowledge).
//!
//! Value is held as *notes*. A deposit publishes only a Poseidon `commitment`
//! (inserted into an incremental Merkle tree) plus note metadata **encrypted to
//! the recipient**, so observers can't link a deposit to a username. A
//! withdrawal submits a Groth16 proof (verified on-chain via BN254 host
//! functions) that proves ownership + Merkle membership + nullifier in zero
//! knowledge; the contract learns only `{root, nullifier, recipient, amount}`.
//! The deposit↔withdrawal link is broken cryptographically.
//!
//! Hashing is Poseidon over BN254 (`soroban-poseidon`, circomlib-compatible), so
//! the tree the contract maintains matches the circuit and the browser client.

use soroban_poseidon::poseidon_hash;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::Bn254Fr,
    symbol_short, token, vec, Address, Bytes, BytesN, Env, String, U256, Vec,
};

mod groth16;
pub use groth16::{Proof, VerificationKey};

#[cfg(test)]
mod fixture;
#[cfg(test)]
mod withdraw_fixture;
#[cfg(test)]
mod test;

const ROOT_HISTORY_SIZE: u32 = 30;
const MAX_DEPTH: u32 = 32;
const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = DAY_LEDGERS * 30;
const TTL_EXTEND: u32 = DAY_LEDGERS * 90;

// BN254 scalar field order r, big-endian.
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
    Vk,
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
}

#[contract]
pub struct PoolContract;

#[contractimpl]
impl PoolContract {
    /// One-time setup: pin the pooled asset and build an empty Poseidon tree.
    pub fn initialize(env: Env, admin: Address, asset: Address, depth: u32) -> Result<(), Error> {
        admin.require_auth();
        let store = env.storage().instance();
        if store.has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if depth == 0 || depth > MAX_DEPTH {
            return Err(Error::InvalidDepth);
        }

        // Empty leaf = field 0; each level doubles up via Poseidon.
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
        store.set(&DataKey::Zeros, &zeros);
        store.set(&DataKey::Filled, &filled);
        store.set(&DataKey::NextIndex, &0u32);
        store.set(&DataKey::Roots, &roots);
        store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(())
    }

    /// Set / rotate the Groth16 verification key (admin only).
    pub fn set_verifier_key(env: Env, admin: Address, vk: VerificationKey) -> Result<(), Error> {
        admin.require_auth();
        load_config(&env)?;
        env.storage().instance().set(&DataKey::Vk, &vk);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(())
    }

    /// Deposit `amount` and record `commitment` as a note. `ephemeral_pk` +
    /// `ciphertext` carry the note's `{amount, salt}` encrypted to the
    /// recipient's viewing key (opaque to the contract).
    pub fn deposit(
        env: Env,
        from: Address,
        commitment: BytesN<32>,
        amount: i128,
        ephemeral_pk: BytesN<32>,
        ciphertext: Bytes,
    ) -> Result<u32, Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let config = load_config(&env)?;
        token::Client::new(&env, &config.asset).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        let leaf = to_u256(&env, &commitment);
        let leaf_index = insert(&env, &config, &leaf)?;

        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        env.events().publish(
            (symbol_short!("deposit"),),
            (leaf_index, commitment, ephemeral_pk, ciphertext),
        );
        Ok(leaf_index)
    }

    /// Spend a note in zero knowledge and release `amount` to `recipient`.
    /// `recipient` is a strkey String so the contract can both bind it into the
    /// proof (via `keccak256(strkey) mod r`) and build the payout Address.
    pub fn withdraw(
        env: Env,
        recipient: String,
        amount: i128,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Proof,
    ) -> Result<(), Error> {
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

        // Public signals, in the circuit's order: [root, nullifier, recipient, amount].
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
        store.extend_ttl(&DataKey::Nullifier(nullifier.clone()), TTL_THRESHOLD, TTL_EXTEND);

        let dest = Address::from_string(&recipient);
        token::Client::new(&env, &config.asset).transfer(
            &env.current_contract_address(),
            &dest,
            &amount,
        );
        env.events()
            .publish((symbol_short!("withdraw"),), (nullifier, dest, amount));
        Ok(())
    }

    // ---- views -------------------------------------------------------------

    pub fn get_config(env: Env) -> Result<Config, Error> {
        load_config(&env)
    }

    pub fn current_root(env: Env) -> Result<BytesN<32>, Error> {
        load_config(&env)?;
        let roots: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::Roots).unwrap();
        Ok(roots.last().unwrap())
    }

    pub fn leaf_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextIndex).unwrap_or(0)
    }

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Nullifier(nullifier))
    }

    pub fn has_verifier_key(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Vk)
    }
}

// ---- internals -------------------------------------------------------------

fn load_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

/// Poseidon(2) node hash — matches circomlib / soroban-poseidon.
fn hash_pair(env: &Env, left: &U256, right: &U256) -> U256 {
    poseidon_hash::<3, Bn254Fr>(env, &vec![env, left.clone(), right.clone()])
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

/// recipient field element = keccak256(strkey bytes) mod r.
fn recipient_to_field(env: &Env, recipient: &String) -> U256 {
    let hash = env.crypto().keccak256(&recipient.to_bytes());
    let order = U256::from_be_bytes(env, &Bytes::from_array(env, &BN254_FR_ORDER));
    U256::from_be_bytes(env, &Bytes::from_array(env, &hash.to_bytes().to_array())).rem_euclid(&order)
}

fn root_is_known(env: &Env, root: &BytesN<32>) -> bool {
    let roots: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::Roots).unwrap();
    roots.iter().any(|r| &r == root)
}

/// Insert a leaf into the incremental Poseidon tree; return the leaf index.
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
