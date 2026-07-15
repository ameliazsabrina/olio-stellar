#![no_std]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, symbol_short, token, vec, Address, Bytes,
    BytesN, Env, IntoVal, Val, Vec,
};

const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = DAY_LEDGERS * 30;
const TTL_EXTEND: u32 = DAY_LEDGERS * 90;

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// The relay account. Only it may move the intake's USDC into the pool.
    pub admin: Address,
    /// The shielded pool contract this intake forwards deposits into.
    pub pool: Address,
    /// The USDC Stellar Asset Contract the CCTP minter credits this intake with.
    pub asset: Address,
}

#[contracttype]
enum DataKey {
    Config,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    InvalidAmount = 2,
}

#[contract]
pub struct IntakeContract;

#[contractimpl]
impl IntakeContract {
    /// Pin the relay `admin`, the `pool`, and the USDC `asset` at deploy time.
    /// Runs once, atomically — there is no re-init or admin-rotation path, so the
    /// admin can never be hijacked after deployment.
    pub fn __constructor(env: Env, admin: Address, pool: Address, asset: Address) {
        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { admin, pool, asset });
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
    }

    /// Forward `amount` of the intake's own USDC balance into the pool as a
    /// shielded note. Only the `admin` (the relay) may call this; the relay has
    /// already resolved + bound the payee and computed `commitment` / the
    /// encrypted note off-chain. The pool pulls the funds from *this* contract's
    /// balance (`from = self`); that transfer is auto-authorized because this
    /// contract initiates the sub-call.
    pub fn deposit_to_pool(
        env: Env,
        commitment: BytesN<32>,
        amount: i128,
        ephemeral_pk: BytesN<32>,
        ciphertext: Bytes,
    ) -> Result<u32, Error> {
        let cfg = load(&env)?;
        cfg.admin.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let from = env.current_contract_address();

        // The pool pulls our USDC via `token.transfer(from = self, to = pool)` —
        // a sub-invocation of `pool.deposit`, one level deeper than the call we
        // make directly. The invoker-contract auth that flows automatically only
        // covers the *direct* call (`pool.deposit`), so we must explicitly
        // authorize this deeper token transfer on our own behalf; otherwise its
        // `from.require_auth()` fails with `Auth, InvalidAction`.
        let transfer_args: Vec<Val> = vec![
            &env,
            from.clone().into_val(&env),
            cfg.pool.clone().into_val(&env),
            amount.into_val(&env),
        ];
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: cfg.asset.clone(),
                    fn_name: symbol_short!("transfer"),
                    args: transfer_args,
                },
                sub_invocations: vec![&env],
            }),
        ]);

        let args: Vec<Val> = vec![
            &env,
            from.into_val(&env),
            commitment.into_val(&env),
            amount.into_val(&env),
            ephemeral_pk.into_val(&env),
            ciphertext.into_val(&env),
        ];
        let leaf_index: u32 = env.invoke_contract(&cfg.pool, &symbol_short!("deposit"), args);

        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(leaf_index)
    }

    /// The intake's current USDC balance (what a CCTP mint credited). Read by the
    /// relay's balance-delta fail-safe before/after `receive_message`.
    pub fn usdc_balance(env: Env) -> i128 {
        match load(&env) {
            Ok(cfg) => {
                token::Client::new(&env, &cfg.asset).balance(&env.current_contract_address())
            }
            Err(_) => 0,
        }
    }

    /// The pinned configuration (admin / pool / asset).
    pub fn config(env: Env) -> Result<Config, Error> {
        load(&env)
    }
}

fn load(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

#[cfg(test)]
mod test;
