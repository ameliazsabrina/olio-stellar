#![no_std]

use soroban_poseidon::poseidon_hash;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contractmeta, contracttype,
    crypto::bn254::Bn254Fr, panic_with_error, symbol_short, token, vec, xdr::ToXdr, Address, Bytes,
    BytesN, Env, String, Vec, U256,
};

contractmeta!(key = "binver", val = "3.0.0");

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
pub const TIMELOCK_SECONDS: u64 = 172_800;

const BN254_FR_ORDER: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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
    PendingGovernance,
    GovernanceNonce,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerifierKind {
    Deposit,
    Withdraw,
    Transfer,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GovernanceAction {
    Upgrade(BytesN<32>),
    SetVerifierKey(VerifierKind, VerificationKey),
    SetAdmin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GovernanceActionKind {
    Upgrade,
    DepositVerifier,
    WithdrawVerifier,
    TransferVerifier,
    Admin,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingGovernance {
    pub proposal_id: u64,
    pub action: GovernanceAction,
    pub payload_hash: BytesN<32>,
    pub proposed_at: u64,
    pub execute_at: u64,
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
    ProposalAlreadyPending = 13,
    NoPendingProposal = 14,
    TimelockNotElapsed = 15,
    ProposalIdMismatch = 16,
    InvalidVerifierKey = 17,
    TimestampOverflow = 18,
    ProposalIdOverflow = 19,
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

#[contractevent(topics = ["admin_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    pub previous_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["gov_proposed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceProposedEvent {
    pub proposal_id: u64,
    pub action_kind: GovernanceActionKind,
    pub payload_hash: BytesN<32>,
    pub execute_at: u64,
}

#[contractevent(topics = ["gov_executed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceExecutedEvent {
    pub proposal_id: u64,
    pub action_kind: GovernanceActionKind,
    pub payload_hash: BytesN<32>,
    pub execute_at: u64,
}

#[contractevent(topics = ["gov_cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceCancelledEvent {
    pub proposal_id: u64,
    pub action_kind: GovernanceActionKind,
    pub payload_hash: BytesN<32>,
    pub execute_at: u64,
}

#[contract]
pub struct PoolContract;

#[contractimpl]
impl PoolContract {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        depth: u32,
        deposit_vk: VerificationKey,
        withdraw_vk: VerificationKey,
        transfer_vk: VerificationKey,
    ) {
        let store = env.storage().instance();
        if depth == 0 || depth > MAX_DEPTH {
            panic_with_error!(&env, Error::InvalidDepth);
        }
        if validate_verifier_key(&deposit_vk, &VerifierKind::Deposit).is_err()
            || validate_verifier_key(&withdraw_vk, &VerifierKind::Withdraw).is_err()
            || validate_verifier_key(&transfer_vk, &VerifierKind::Transfer).is_err()
        {
            panic_with_error!(&env, Error::InvalidVerifierKey);
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
        store.set(&DataKey::VkDeposit, &deposit_vk);
        store.set(&DataKey::Vk, &withdraw_vk);
        store.set(&DataKey::VkTransfer, &transfer_vk);
        store.set(&DataKey::Zeros, &zeros);
        store.set(&DataKey::Filled, &filled);
        store.set(&DataKey::NextIndex, &0u32);
        store.set(&DataKey::Roots, &roots);
        store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
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

    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<u64, Error> {
        propose_governance(&env, GovernanceAction::Upgrade(new_wasm_hash))
    }

    pub fn propose_verifier_key(
        env: Env,
        kind: VerifierKind,
        vk: VerificationKey,
    ) -> Result<u64, Error> {
        propose_governance(&env, GovernanceAction::SetVerifierKey(kind, vk))
    }

    pub fn propose_admin(env: Env, new_admin: Address) -> Result<u64, Error> {
        propose_governance(&env, GovernanceAction::SetAdmin(new_admin))
    }

    pub fn execute_governance(env: Env, proposal_id: u64) -> Result<(), Error> {
        let pending: PendingGovernance = env
            .storage()
            .instance()
            .get(&DataKey::PendingGovernance)
            .ok_or(Error::NoPendingProposal)?;
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        if proposal_id != pending.proposal_id {
            return Err(Error::ProposalIdMismatch);
        }
        if env.ledger().timestamp() < pending.execute_at {
            return Err(Error::TimelockNotElapsed);
        }
        if let GovernanceAction::SetAdmin(new_admin) = &pending.action {
            new_admin.require_auth();
        }
        let action_kind = governance_action_kind(&pending.action);
        env.storage().instance().remove(&DataKey::PendingGovernance);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        GovernanceExecutedEvent {
            proposal_id,
            action_kind,
            payload_hash: pending.payload_hash.clone(),
            execute_at: pending.execute_at,
        }
        .publish(&env);
        match pending.action {
            GovernanceAction::Upgrade(new_wasm_hash) => {
                let admin: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Admin)
                    .ok_or(Error::NotInitialized)?;
                UpgradeEvent {
                    admin,
                    new_wasm_hash: new_wasm_hash.clone(),
                }
                .publish(&env);
                env.deployer().update_current_contract_wasm(new_wasm_hash);
            }
            GovernanceAction::SetVerifierKey(kind, vk) => {
                let key = verifier_data_key(&kind);
                env.storage().instance().set(&key, &vk);
            }
            GovernanceAction::SetAdmin(new_admin) => {
                let previous_admin: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Admin)
                    .ok_or(Error::NotInitialized)?;
                env.storage().instance().set(&DataKey::Admin, &new_admin);
                AdminChangedEvent {
                    previous_admin,
                    new_admin,
                }
                .publish(&env);
            }
        }
        Ok(())
    }

    pub fn cancel_governance(env: Env, proposal_id: u64) -> Result<(), Error> {
        require_admin(&env)?;
        let pending: PendingGovernance = env
            .storage()
            .instance()
            .get(&DataKey::PendingGovernance)
            .ok_or(Error::NoPendingProposal)?;
        if proposal_id != pending.proposal_id {
            return Err(Error::ProposalIdMismatch);
        }
        let action_kind = governance_action_kind(&pending.action);
        env.storage().instance().remove(&DataKey::PendingGovernance);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        GovernanceCancelledEvent {
            proposal_id,
            action_kind,
            payload_hash: pending.payload_hash,
            execute_at: pending.execute_at,
        }
        .publish(&env);
        Ok(())
    }

    pub fn pending_governance(env: Env) -> Option<PendingGovernance> {
        let pending = env.storage().instance().get(&DataKey::PendingGovernance);
        if pending.is_some() {
            env.storage()
                .instance()
                .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        }
        pending
    }
}

fn propose_governance(env: &Env, action: GovernanceAction) -> Result<u64, Error> {
    require_admin(env)?;
    if let GovernanceAction::SetVerifierKey(kind, vk) = &action {
        validate_verifier_key(vk, kind)?;
    }
    let store = env.storage().instance();
    if store.has(&DataKey::PendingGovernance) {
        return Err(Error::ProposalAlreadyPending);
    }
    let previous_id: u64 = store.get(&DataKey::GovernanceNonce).unwrap_or(0);
    let proposal_id = previous_id
        .checked_add(1)
        .ok_or(Error::ProposalIdOverflow)?;
    let proposed_at = env.ledger().timestamp();
    let execute_at = proposed_at
        .checked_add(TIMELOCK_SECONDS)
        .ok_or(Error::TimestampOverflow)?;
    let payload_hash = env.crypto().sha256(&action.clone().to_xdr(env)).to_bytes();
    let action_kind = governance_action_kind(&action);
    let pending = PendingGovernance {
        proposal_id,
        action,
        payload_hash: payload_hash.clone(),
        proposed_at,
        execute_at,
    };
    store.set(&DataKey::GovernanceNonce, &proposal_id);
    store.set(&DataKey::PendingGovernance, &pending);
    store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
    GovernanceProposedEvent {
        proposal_id,
        action_kind,
        payload_hash,
        execute_at,
    }
    .publish(env);
    Ok(proposal_id)
}

fn governance_action_kind(action: &GovernanceAction) -> GovernanceActionKind {
    match action {
        GovernanceAction::Upgrade(_) => GovernanceActionKind::Upgrade,
        GovernanceAction::SetVerifierKey(VerifierKind::Deposit, _) => {
            GovernanceActionKind::DepositVerifier
        }
        GovernanceAction::SetVerifierKey(VerifierKind::Withdraw, _) => {
            GovernanceActionKind::WithdrawVerifier
        }
        GovernanceAction::SetVerifierKey(VerifierKind::Transfer, _) => {
            GovernanceActionKind::TransferVerifier
        }
        GovernanceAction::SetAdmin(_) => GovernanceActionKind::Admin,
    }
}

fn verifier_data_key(kind: &VerifierKind) -> DataKey {
    match kind {
        VerifierKind::Deposit => DataKey::VkDeposit,
        VerifierKind::Withdraw => DataKey::Vk,
        VerifierKind::Transfer => DataKey::VkTransfer,
    }
}

fn validate_verifier_key(vk: &VerificationKey, kind: &VerifierKind) -> Result<(), Error> {
    let expected_len = match kind {
        VerifierKind::Deposit => 3,
        VerifierKind::Withdraw | VerifierKind::Transfer => 5,
    };
    if vk.ic.len() != expected_len {
        return Err(Error::InvalidVerifierKey);
    }
    for point in vk.ic.iter() {
        let _ = point.to_array();
    }
    Ok(())
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
