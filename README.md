# Olio — private USDC payments on Stellar

Confidential USDC payment links for freelancers and small businesses. Share a
link, get paid in USDC as an unlinkable note in a Soroban shielded pool, and
cash out when you want. **Private by default, provable on demand.**

This repo is **Milestone 1 (testnet)** — the smallest honest slice of Olio that
runs the full loop end to end:

- `programs/olio-registry` — username accounts (`@dinar` is the payment link)
- `programs/olio-pool` — the shielded pool: notes, an incremental Merkle tree of
  commitments, nullifiers, and USDC custody via the Stellar Asset Contract
- `frontend` — a Next.js + Freighter app: create an account, receive payments,
  scan for your notes, and claim/withdraw
- `scripts/deploy-testnet.sh` — build, deploy, and wire everything to testnet USDC

> ### ⚠️ Milestone-1 privacy caveat
> This iteration is the deployable **plumbing**: correct custody, commitments,
> Merkle membership, and double-spend prevention. It is **not yet unlinkable** —
> `withdraw` reveals a note's fields and Merkle path on-chain, and deposit events
> carry `amount`/`salt` in the clear for discovery. True zero-knowledge
> unlinkability arrives in the next iteration, when a Groth16 verifier (over
> Stellar's BLS12-381 host functions) + in-browser proving replace the in-contract
> path checks. Hashing is keccak256 in M1 and moves to Poseidon to match the circuit.

## How it works

```
Payer (Freighter)                      Recipient (Freighter)
   │  pay @username                        │  register @username
   ▼                                       ▼
olio-registry  ──resolve(@username)──►  note_pubkey
   │                                       ▲
   ▼                                       │ scan events, match, claim
olio-pool (holds USDC via SAC) ── deposit → commitment leaf → Merkle tree
                                └ withdraw → nullifier + payout USDC
```

Note model (keccak256 byte layouts, shared by contract and client):

- `owner_pk   = keccak256(owner_secret[32])`
- `commitment = keccak256(amount_be[16] ++ owner_pk[32] ++ salt[32])`
- `nullifier  = keccak256(owner_secret[32] ++ leaf_index_be_u64[8])`

## Prerequisites

- Rust with the `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- Stellar CLI 27+
- Node 20+ and pnpm 10+
- The [Freighter](https://www.freighter.app/) browser extension

## Contracts

```sh
cargo test -p olio-registry -p olio-pool   # unit tests + JS↔Rust hash-parity gate
stellar contract build                     # build both wasms
```

## Deploy to testnet

```sh
./scripts/deploy-testnet.sh alice
```

This creates+funds the `alice` identity if needed, derives the Circle testnet
USDC Stellar Asset Contract, deploys the registry + pool, initializes the pool,
and writes all IDs into `frontend/.env.local`.

Verify hash parity against the deployed empty tree:

```sh
NODE_PATH=frontend/node_modules node scripts/parity.cjs
# zeros_root20 must equal the pool's current_root
```

## Frontend

```sh
pnpm install
pnpm --filter frontend dev   # http://localhost:3000
```

To **pay** a link you need testnet USDC: connect Freighter, use the "Add USDC
trustline" button on the home page, then fund at
[faucet.circle.com](https://faucet.circle.com). Receiving notes needs no USDC.

### End-to-end test (two Freighter accounts)

1. **Recipient** opens `/`, connects, and claims a username (e.g. `dinar`).
2. **Payer** (second account with testnet USDC) opens `/pay/dinar`, enters an
   amount, and pays. A note is minted into the pool.
3. **Recipient** opens `/wallet`; the note appears with a claimable balance.
   Claim it to any address — funds arrive and the note is marked spent.
   Re-claiming is rejected (nullifier reuse).

## Deferred to later phases

Real zk unlinkability (Circom circuit + trusted setup + WASM proving + on-chain
BLS12-381 Groth16 verifier), passkeys/gasless, cross-chain CCTP deposits, SEP-24
fiat off-ramp, digital-product delivery, selective disclosure + ASP screening,
B2B multisig, a dedicated event indexer, and a security audit.
