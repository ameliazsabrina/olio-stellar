extern crate std;

use super::{Account, Error, RegistryContract, RegistryContractClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn setup(env: &Env) -> RegistryContractClient<'_> {
    let contract_id = env.register(RegistryContract, ());
    RegistryContractClient::new(env, &contract_id)
}

fn pk(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn register_and_resolve() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let owner = Address::generate(&env);
    let name = String::from_str(&env, "dinar");
    let key = pk(&env, 7);

    client.register(&owner, &name, &key, &pk(&env, 200));

    let account: Account = client.resolve(&name);
    assert_eq!(account.owner, owner);
    assert_eq!(account.note_pubkey, key);
    assert_eq!(client.owner_of(&name), owner);
    assert_eq!(client.username_of(&owner), Some(name));
}

#[test]
fn duplicate_username_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let name = String::from_str(&env, "dinar");

    client.register(&a, &name, &pk(&env, 1), &pk(&env, 201));
    let err = client.try_register(&b, &name, &pk(&env, 2), &pk(&env, 202)).err().unwrap();
    assert_eq!(err, Ok(Error::UsernameTaken));
}

#[test]
fn one_username_per_owner() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let owner = Address::generate(&env);
    client.register(&owner, &String::from_str(&env, "dinar"), &pk(&env, 1), &pk(&env, 203));
    let err = client
        .try_register(&owner, &String::from_str(&env, "dinar2"), &pk(&env, 2), &pk(&env, 204))
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::OwnerHasUsername));
}

#[test]
fn too_short_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let owner = Address::generate(&env);
    let err = client
        .try_register(&owner, &String::from_str(&env, "ab"), &pk(&env, 1), &pk(&env, 205))
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::UsernameTooShort));
}

#[test]
fn rotate_pubkey() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let owner = Address::generate(&env);
    let name = String::from_str(&env, "dinar");
    client.register(&owner, &name, &pk(&env, 1), &pk(&env, 206));

    let new_key = pk(&env, 9);
    let new_view = pk(&env, 99);
    client.set_pubkey(&owner, &name, &new_key, &new_view);
    let acct = client.resolve(&name);
    assert_eq!(acct.note_pubkey, new_key);
    assert_eq!(acct.view_pubkey, new_view);
}

#[test]
fn set_pubkey_wrong_owner_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let owner = Address::generate(&env);
    let name = String::from_str(&env, "dinar");
    client.register(&owner, &name, &pk(&env, 1), &pk(&env, 206));

    let intruder = Address::generate(&env);
    let err = client
        .try_set_pubkey(&intruder, &name, &pk(&env, 9), &pk(&env, 99))
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::UsernameNotFound));
}

#[test]
fn resolve_missing_errors() {
    let env = Env::default();
    let client = setup(&env);
    let err = client
        .try_resolve(&String::from_str(&env, "ghost"))
        .err()
        .unwrap();
    assert_eq!(err, Ok(Error::UsernameNotFound));
}
