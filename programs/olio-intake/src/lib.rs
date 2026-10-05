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
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeeChannel {
    Direct,
    Cctp,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeQuote {
    pub format_version: u32,
    pub policy_version: u32,
    pub quote_id: BytesN<32>,
    pub network_id: BytesN<32>,
    pub pool: Address,
    pub depositor: Address,
    pub commitment: BytesN<32>,
    pub payment_amount: i128,
    pub fee_bps: u32,
    pub fee_amount: i128,
    pub total_amount: i128,
    pub channel: FeeChannel,
    pub source_domain: u32,
    pub source_payer: BytesN<32>,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub pool: Address,
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
    InvalidQuote = 3,
}

#[contract]
pub struct IntakeContract;

#[contractimpl]
impl IntakeContract {
    pub fn __constructor(env: Env, admin: Address, pool: Address, asset: Address) {
        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { admin, pool, asset });
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
    }

    pub fn deposit_to_pool(
        env: Env,
        commitment: BytesN<32>,
        payment_amount: i128,
        quote: FeeQuote,
        signature: BytesN<64>,
        proof: Val,
        ephemeral_pk: BytesN<32>,
        ciphertext: Bytes,
    ) -> Result<u32, Error> {
        let cfg = load(&env)?;
        cfg.admin.require_auth();
        if payment_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let from = env.current_contract_address();
        if quote.depositor != from
            || quote.pool != cfg.pool
            || quote.commitment != commitment
            || quote.payment_amount != payment_amount
            || quote.total_amount < payment_amount
            || quote.channel != FeeChannel::Cctp
        {
            return Err(Error::InvalidQuote);
        }

        let transfer_args: Vec<Val> = vec![
            &env,
            from.clone().into_val(&env),
            cfg.pool.clone().into_val(&env),
            quote.total_amount.into_val(&env),
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
            payment_amount.into_val(&env),
            quote.into_val(&env),
            signature.into_val(&env),
            proof,
            ephemeral_pk.into_val(&env),
            ciphertext.into_val(&env),
        ];
        let leaf_index: u32 = env.invoke_contract(&cfg.pool, &symbol_short!("deposit"), args);

        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
        Ok(leaf_index)
    }

    pub fn usdc_balance(env: Env) -> i128 {
        match load(&env) {
            Ok(cfg) => {
                token::Client::new(&env, &cfg.asset).balance(&env.current_contract_address())
            }
            Err(_) => 0,
        }
    }

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
