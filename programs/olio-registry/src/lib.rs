#![no_std]

//! Olio username registry.
//!
//! Maps a human-readable `@username` to the on-chain account that should
//! receive private payments. A username is Olio's payment-link surface: a payer
//! resolves `@dinar` here to obtain the recipient's `note_pubkey`, then builds a
//! shielded note addressed to it in the pool contract.
//!
//! Milestone 1 keeps this deliberately small: one username per owner, a
//! rotatable note key, and simple length validation (richer charset rules are
//! enforced by the frontend).

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String};

const MIN_LEN: u32 = 3;
const MAX_LEN: u32 = 32;

#[contracttype]
#[derive(Clone)]
pub struct Account {
    /// Address that controls this username (signs to update it).
    pub owner: Address,
    /// Poseidon note key (`owner_pk`) payers use to build shielded-note
    /// commitments this user can spend.
    pub note_pubkey: BytesN<32>,
    /// x25519 viewing public key payers use to encrypt note metadata
    /// (`{amount, salt}`) so only this user can discover the note.
    pub view_pubkey: BytesN<32>,
    /// Ledger timestamp the username was registered at.
    pub created: u64,
}

#[contracttype]
enum DataKey {
    /// username -> Account
    Name(String),
    /// owner -> username (enforces one username per owner)
    Owner(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    UsernameTaken = 1,
    OwnerHasUsername = 2,
    UsernameNotFound = 3,
    UsernameTooShort = 4,
    UsernameTooLong = 5,
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    /// Claim `username` for `owner`, addressed by `note_pubkey`.
    pub fn register(
        env: Env,
        owner: Address,
        username: String,
        note_pubkey: BytesN<32>,
        view_pubkey: BytesN<32>,
    ) -> Result<(), Error> {
        owner.require_auth();
        validate_len(&username)?;

        let names = env.storage().persistent();
        if names.has(&DataKey::Name(username.clone())) {
            return Err(Error::UsernameTaken);
        }
        if names.has(&DataKey::Owner(owner.clone())) {
            return Err(Error::OwnerHasUsername);
        }

        let account = Account {
            owner: owner.clone(),
            note_pubkey,
            view_pubkey,
            created: env.ledger().timestamp(),
        };
        names.set(&DataKey::Name(username.clone()), &account);
        names.set(&DataKey::Owner(owner), &username);
        Ok(())
    }

    /// Rotate the note key for a username. Only the current owner may call.
    pub fn set_pubkey(
        env: Env,
        owner: Address,
        username: String,
        note_pubkey: BytesN<32>,
    ) -> Result<(), Error> {
        owner.require_auth();
        let store = env.storage().persistent();
        let mut account: Account = store
            .get(&DataKey::Name(username.clone()))
            .ok_or(Error::UsernameNotFound)?;
        // `owner.require_auth()` above plus this equality check binds the update
        // to the real controller of the username.
        if account.owner != owner {
            return Err(Error::UsernameNotFound);
        }
        account.note_pubkey = note_pubkey;
        store.set(&DataKey::Name(username), &account);
        Ok(())
    }

    /// Full account record for a username.
    pub fn resolve(env: Env, username: String) -> Result<Account, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Name(username))
            .ok_or(Error::UsernameNotFound)
    }

    /// Controlling address for a username.
    pub fn owner_of(env: Env, username: String) -> Result<Address, Error> {
        Self::resolve(env, username).map(|a| a.owner)
    }

    /// The username owned by `owner`, if any.
    pub fn username_of(env: Env, owner: Address) -> Option<String> {
        env.storage().persistent().get(&DataKey::Owner(owner))
    }
}

fn validate_len(username: &String) -> Result<(), Error> {
    let len = username.len();
    if len < MIN_LEN {
        return Err(Error::UsernameTooShort);
    }
    if len > MAX_LEN {
        return Err(Error::UsernameTooLong);
    }
    Ok(())
}

#[cfg(test)]
mod test;
