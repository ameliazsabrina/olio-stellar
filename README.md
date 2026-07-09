# Olio — private USDC payments on Stellar

Confidential USDC payment links for freelancers and small businesses. Share a
link, get paid in USDC as an **unlinkable, zero-knowledge** note in a Soroban
shielded pool, and cash out when you want. **Private by default, provable on demand.**

This repo is **Iteration 2 (testnet)** — real zero-knowledge privacy end to end:

- `programs/olio-registry` — username accounts (`@dinar` is the payment link);
  holds each user's Poseidon note key + x25519 viewing key
- `programs/olio-pool` — the shielded pool: a Poseidon Merkle tree of commitments,
  nullifiers, USDC custody via the SAC, and an **on-chain Groth16 verifier (BN254)**
- `circuits/` — the `withdraw.circom` circuit + Groth16 trusted setup
- `web` — Next.js + Freighter: create an account, receive encrypted notes,
  and **generate a withdrawal proof in your browser** to claim
- `scripts/deploy-testnet.sh` — build, deploy, wire USDC, and register the VK

## What's private

A deposit publishes only a Poseidon `commitment` (inserted into the Merkle tree)
plus note metadata **encrypted to the recipient's viewing key** — so observers
can't link a deposit to a username. A withdrawal submits a Groth16 proof that
proves note ownership + Merkle membership + nullifier **in zero knowledge**; the
contract learns only `{root, nullifier, recipient, amount}`. The deposit↔withdrawal
link is broken cryptographically. Amounts remain visible at withdrawal (hiding
amounts is a PRD v1 non-goal).

> The Groth16 trusted setup here is **dev-only**. A production launch needs a real
> multi-party ceremony, plus a security audit of the circuit and contracts.

## How it works

```
Payer (Freighter)                         Recipient (Freighter)
   │  resolve @username → note_pk + view_pk   │  register @username
   ▼                                          ▼
olio-pool.deposit(commitment, amount,       scan events → x25519-decrypt → my notes
                  ephemeral_pk, ciphertext) ─────────────┐
   │  Poseidon leaf → Merkle tree                        │ browser: snarkjs proof
   ▼                                                     ▼
olio-pool.withdraw(recipient, amount, root, nullifier, proof)
   └── BN254 Groth16 verify → pay USDC, record nullifier
```

Note model (Poseidon over BN254 — circomlib params, identical in circuit /
contract / browser):

- `owner_pk   = Poseidon([owner_secret])`
- `commitment = Poseidon([amount, owner_pk, salt])`
- `nullifier  = Poseidon([owner_secret, leaf_index])`
- `node       = Poseidon([left, right])`

## Prerequisites

- Rust with `wasm32v1-none`; Stellar CLI 27+
- Node 20+, pnpm 10+; **circom 2** + snarkjs (for the circuit build)
- The [Freighter](https://www.freighter.app/) browser extension

## Build & test

```sh
# Contracts (unit tests incl. an on-chain proof + full withdraw flow with a real proof)
cargo test -p olio-registry -p olio-pool

# Circuit + trusted setup (reuses Powers-of-Tau if present; stages wasm/zkey + VK)
cd circuits && npm install && ./build.sh
```

## Deploy to testnet

```sh
./scripts/deploy-testnet.sh alice   # deploys, initializes, registers the VK, writes .env.local
```

## Web

```sh
pnpm install
pnpm --filter web dev   # http://localhost:3000
```

To **pay**, you need testnet USDC: connect Freighter, "Add USDC trustline", then
fund at [faucet.circle.com](https://faucet.circle.com). Receiving needs no USDC.

### End-to-end (two Freighter accounts)

1. **Recipient** opens `/`, connects, claims a username (keys are generated locally).
2. **Payer** (funded) opens `/pay/<username>`, enters an amount, pays — a note is
   minted with metadata encrypted to the recipient.
3. **Recipient** opens `/wallet`; the note is discovered by decryption. Claiming
   generates a zk proof in the browser (~a few seconds) and withdraws to any
   address. Replays are rejected (nullifier); a swapped recipient fails (bound in
   the proof).

## Key implementation notes

- Curve **BN254** end to end (snarkjs-native + Soroban `bn254` host functions), so
  no proof conversion. Poseidon via `soroban-poseidon` (contract) / `circomlibjs`
  (browser) / `circomlib` (circuit) — all circomlib-compatible.
- snarkjs → Soroban serialization: G1 `X‖Y` (32B BE each); **G2 per coordinate
  `c1‖c0`** (imaginary-first swap from snarkjs's `[c0,c1]`); Fr 32B BE. Proof `A`
  is passed as-is (the verifier negates it). This is validated on-chain by
  `groth16_verifies_real_proof`.
- Contract pinned to **soroban-sdk 26** (matches `soroban-poseidon` + BN254).

## Deferred (later phases)
Production MPC ceremony + security audit, fixed-denomination anonymity sets,
selective disclosure + ASP screening, passkeys/gasless, cross-chain CCTP, SEP-24
off-ramp, a dedicated event indexer.
