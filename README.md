# Olio - private USDC payments on Stellar

Olio lets freelancers and small businesses accept USDC through simple payment
links without exposing their full payment history on a public ledger.

Clients pay a link. Olio turns that payment into a private note in a Stellar
shielded pool. The recipient can later claim the funds to a Stellar address,
cash out through a SEP-24 anchor, or generate a disclosure bundle for accounting,
tax, bank, or audit review.

This repository is the testnet implementation. It contains the Soroban
contracts, zero-knowledge circuits, browser app, payment-link database, CCTP
relay flow, passkey wallet support, and disclosure tooling.

## What Olio Protects

Public blockchains make payment relationships easy to inspect. If a business
uses one wallet for invoices, anyone can often see who paid, when they paid, and
how much revenue the wallet received.

Olio breaks the direct link between the incoming payment and the later claim:

- A payment creates a note commitment in the pool, not a public recipient payout.
- The note details are encrypted to the recipient's viewing key.
- The recipient scans pool events locally and decrypts only notes meant for them.
- A later claim uses a zero-knowledge proof to show the note is valid without
  revealing which deposit created it.
- A nullifier prevents the same note from being spent twice.

Amounts are still visible when funds leave the pool. Olio's current privacy goal
is unlinkability between deposit and withdrawal, not hidden withdrawal amounts.

## How The System Works

```text
Recipient
  claims @username
  publishes note key + viewing key in olio-registry

Payer
  opens /pay/<username>
  resolves the recipient keys
  pays USDC through Stellar or CCTP
  creates an encrypted private note

Shielded pool
  stores only the note commitment in a Poseidon Merkle tree
  keeps USDC custody in the Stellar Asset Contract

Recipient
  scans deposit events
  decrypts notes locally
  proves note ownership in the browser
  withdraws, cashes out, or discloses selected payment evidence
```

The important idea: the pool can verify that a recipient owns a valid note, but
it does not learn which deposit event produced that note.

## Repository Map

- `programs/olio-registry` - username registry. Maps `@username` to the owner
  address, Poseidon note public key, and x25519 viewing public key.
- `programs/olio-pool` - shielded USDC pool. Stores note commitments, maintains
  the Poseidon Merkle tree, verifies Groth16 proofs, releases withdrawals, and
  records nullifiers.
- `programs/olio-intake` - CCTP intake contract. Receives USDC minted on Stellar
  from Circle CCTP and forwards it into the shielded pool as a private note.
- `circuits/` - Circom circuits for withdrawing and shielded transfers, plus
  scripts that export Soroban-compatible verification keys.
- `web/` - Next.js app for onboarding, payment links, payer checkout, local note
  scanning, proof generation, withdrawals, SEP-24 cash-out, CCTP payments, and
  disclosure bundles.
- `vendor/passkey-contracts/` - vendored passkey smart-wallet contracts used for
  passkey-based account setup.
- `scripts/deploy-testnet.sh` - builds and deploys the contracts to Stellar
  testnet, uploads the passkey wallet WASM, sets verifier keys, deploys CCTP
  intake, and writes `web/.env.local`.

## Core Flows

### 1. Account setup

A user claims a username such as `@dinar`. The app generates local note and
viewing keys, then registers their public keys in `olio-registry`.

The note key lets payers create notes the user can spend. The viewing key lets
payers encrypt note metadata so only the recipient can discover their payments.

### 2. Payment links

The dashboard creates shareable payment links and QR codes. Link metadata lives
in MongoDB, but private note contents do not. A payer can pay a general username
link or a managed link with a fixed amount and label.

### 3. Direct Stellar payment

A Stellar payer pays USDC into `olio-pool.deposit`. The app computes:

```text
owner_pk   = Poseidon(owner_secret)
commitment = Poseidon(amount, owner_pk, salt)
nullifier  = Poseidon(owner_secret, leaf_index)
```

The contract stores the commitment as a Merkle leaf and publishes encrypted note
metadata in the deposit event.

### 4. Cross-chain payment with CCTP

A payer can burn testnet USDC on a supported source chain. Circle attests the
burn, then the server relay mints USDC on Stellar to `olio-intake`.

The relay verifies the CCTP message is bound to the intended recipient, then
calls `olio-intake.deposit_to_pool`. The intake contract forwards the minted USDC
into `olio-pool` and creates the same kind of private note as a direct Stellar
payment.

Current testnet sources include:

- Ethereum Sepolia
- Base Sepolia
- Arbitrum Sepolia
- Avalanche Fuji
- Solana Devnet

### 5. Wallet scanning

The recipient's browser reads deposit events and tries to decrypt each note with
the local viewing key. Notes that decrypt successfully appear in the dashboard.

The server indexer caches public event data and usernames for performance. It
does not need the recipient's private note secret.

### 6. Withdrawal

To claim a note, the browser builds a Merkle proof, generates a Groth16 proof,
and submits:

```text
root, nullifier, recipient, amount, proof
```

The pool verifies the proof with Stellar's BN254 host functions, checks the root
is known, checks the nullifier has not been used, records the nullifier, and
transfers USDC to the destination.

### 7. SEP-24 cash-out

For bank cash-out, Olio creates a fresh single-use bridge account, withdraws the
private note to that account, then opens a SEP-24 withdrawal session with the
configured anchor. Bank details are handled by the anchor, not by Olio.

On testnet the bridge account is funded by friendbot. A production deployment
needs sponsorship and operational controls instead.

### 8. Selective disclosure

A recipient can export evidence for a specific payment. The disclosure bundle
contains the note amount, salt, owner key, Merkle path, root, commitment, pool,
network, username, and timestamp. A verifier can recompute the commitment and
root to confirm that the disclosed payment existed without exposing the user's
full wallet history.

## Privacy Model

Olio keeps routine payment activity private by default, while preserving a way
to prove selected payments later.

What observers can see:

- A deposit commitment was added to the pool.
- A withdrawal happened for a visible amount and destination.
- A nullifier was used once.

What observers should not be able to link directly:

- Which username received a specific deposit.
- Which deposit funded a later withdrawal.
- Which private notes belong to a user unless the user discloses them.

What is intentionally not hidden yet:

- Withdrawal amount.
- Withdrawal destination.
- Timing patterns if users withdraw immediately after receiving funds.

## Prerequisites

- Rust with the `wasm32v1-none` target.
- Stellar CLI 27 or newer.
- Node 20 or newer.
- pnpm 10 or newer.
- circom 2 and snarkjs for circuit builds.
- MongoDB for the web app's cached users, payment links, and indexer data.
- Freighter or another supported Stellar wallet for browser testing.

## Build And Test

Install web dependencies:

```sh
pnpm install
```

Build and test contracts:

```sh
stellar contract build
cargo test -p olio-registry -p olio-pool -p olio-intake
```

Build circuits and export Soroban verification keys:

```sh
cd circuits
npm install
./build.sh
```

Run web checks:

```sh
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web build
```

## Deploy To Stellar Testnet

Build the circuits first, then deploy:

```sh
./scripts/deploy-testnet.sh alice
```

The deploy script:

- Creates and funds the deployer identity if needed.
- Builds registry, pool, and intake contracts.
- Resolves the Circle testnet USDC Stellar Asset Contract.
- Deploys `olio-registry` and `olio-pool`.
- Initializes the pool with USDC and tree depth.
- Sets withdraw and transfer Groth16 verifier keys.
- Builds and uploads the passkey smart-wallet WASM.
- Creates a CCTP operator identity.
- Deploys `olio-intake`.
- Writes the resulting contract IDs and CCTP operator secret to `web/.env.local`.

## Web App

Copy the example environment file and fill in deployed contract IDs or run the
testnet deploy script:

```sh
cp web/.env.example web/.env.local
pnpm --filter web dev
```

The app runs at:

```text
http://localhost:3000
```

Useful routes:

- `/` - landing and onboarding.
- `/dashboard` - private balance overview.
- `/dashboard/links` - manage payment links.
- `/dashboard/withdraw` - withdraw to Stellar or cash out through SEP-24.
- `/dashboard/history` - local payment history.
- `/pay/<username>` - payer checkout.
- `/pay/<username>/<slug>` - managed payment-link checkout.

## Environment

The web app reads public testnet configuration from `NEXT_PUBLIC_*` variables
and server-only secrets from plain variables.

Important server-only values:

- `MONGODB_URI` - MongoDB connection string.
- `CRON_SECRET` - long random bearer token used by Vercel Cron to authorize the
  one-minute pool-indexer request.
- `CHANNELS_API_KEY` - OpenZeppelin Relayer Channels key, when using Channels.
- `CCTP_OPERATOR_SECRET` - Stellar secret key for the CCTP intake operator.
- `CIRCLE_API_KEY` - Circle API key for Iris attestation access if required.

Do not commit `web/.env.local`. The repository intentionally ignores `.env*`
files except `.env.example`.

Before deploying the asynchronous pool indexer, apply the Mongo migrations:

```sh
pnpm --filter web migrate:up
```

The production deployment schedules `/api/cron/pool-indexer` every minute.
After deploying a new testnet pool contract, invoke that route once with
`Authorization: Bearer <CRON_SECRET>` and confirm it reports `status: synced`
before relying on the dashboard mirror. Contract-id changes automatically clear
and rebuild the public encrypted deposit/nullifier mirror; they never clear user
keys or other application collections.

## Testnet Payment Notes

To test direct Stellar payments, the payer needs testnet USDC:

1. Connect a Stellar wallet.
2. Add the USDC trustline.
3. Fund testnet USDC from Circle's faucet.
4. Pay a username or payment link.

Receiving does not require the recipient to hold USDC first. They only need
their Olio account keys so they can decrypt and later spend their notes.

## Implementation Notes

- The proof system uses BN254 end to end: Circom/snarkjs in the browser and
  Stellar BN254 host functions in Soroban.
- Poseidon hashing is kept compatible across circuit, contract, and browser.
- The pool keeps a rolling root history so recent Merkle proofs can still be
  accepted after newer deposits.
- Proof public signals for withdrawals are ordered as
  `[root, nullifier, recipient, amount]`.
- Proof public signals for shielded transfers are ordered as
  `[root, nullifier, outCommitmentRecipient, outCommitmentChange]`.
- `olio-registry.set_pubkey` rotates both the note public key and viewing public
  key, because re-keying only one side would make future note discovery fail.
- CCTP burns carry a binding derived from the payee note key and payer nonce, so
  the relay can reject attempts to redirect a burn to another username.

## Production Work Still Required

This repo is testnet-stage. Before mainnet, Olio still needs:

- A real multi-party trusted setup ceremony for production circuits.
- Independent security review of the contracts, circuits, relay, and web flows.
- Mainnet CCTP, SEP-24, and passkey operational hardening.
- Sponsored-account strategy for bridge accounts instead of friendbot funding.
- Monitoring, alerting, and runbooks for relay and indexer operations.
- Clear compliance policy for supported anchors, disclosure, abuse handling, and
  jurisdiction-specific requirements.
