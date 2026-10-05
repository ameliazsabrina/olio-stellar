# Olio - private USDC payments on Stellar

Olio lets freelancers and small businesses accept USDC through simple payment
links without exposing their full payment history on a public ledger.

Clients pay a link. Olio turns that payment into a private note in a Stellar
shielded pool. The recipient can later claim the funds to a Stellar address,
generate a disclosure bundle for accounting,
tax, bank, or audit review.

This repository is the testnet implementation. It contains the Soroban
contracts, zero-knowledge circuits, browser app, payment-link database, CCTP
relay flow, Privy authentication with user-owned Stellar embedded wallets, and disclosure tooling.

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
- `programs/olio-account` - minimal C-address account controlled by one Privy
  Stellar Ed25519 wallet.
- `circuits/` - Circom circuits for withdrawing and shielded transfers, plus
  scripts that export Soroban-compatible verification keys.
- `web/` - Next.js app for onboarding, payment links, payer checkout, local note
  scanning, proof generation, withdrawals, CCTP payments, and
  disclosure bundles.
- `scripts/deploy-testnet.sh` - builds and deploys the contracts to Stellar
  testnet, uploads the Olio account WASM, sets verifier keys, deploys CCTP
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

A Stellar payer pays USDC into `olio-pool.deposit`. The requested amount is the
private-note principal. Fee policy v2 adds the receiving client's server-resolved
2% or 5% Olio service fee, rounded down in base units, on top. A dedicated
pricing authority signs the exact recipient-bound quote and the pool verifies it
before settlement. The pool atomically pulls the signed gross total, forwards the fee
to its governed treasury, and retains only the principal backing the note. The
app computes:

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

The payer burns principal plus the signed 2% or 5% fee. A domain-separated v3
hook binds the canonical immutable payment-quote digest. The relay verifies
the binding and exact gross amount, then
calls `olio-intake.deposit_to_pool`. The intake contract forwards the minted USDC
into `olio-pool`; the pool forwards the fee and creates a note for the full
requested principal.

Private pool transfers are disabled in this deployment so they cannot bypass a
recipient's configured checkout tier. Withdrawals remain available.

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

### 7. Selective disclosure

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
- Builds account, registry, pool, and intake contracts.
- Resolves the Circle testnet USDC Stellar Asset Contract.
- Deploys `olio-registry` and `olio-pool`.
- Initializes the pool with USDC and tree depth.
- Sets withdraw and transfer Groth16 verifier keys.
- Uploads the Olio account WASM.
- Creates a CCTP operator identity.
- Deploys `olio-intake`.
- Writes the resulting contract IDs and CCTP operator secret to `web/.env.local`.
- Writes an eligible-but-uncertified `CCTP_ROUTE_MANIFEST`, preserves or
  generates `CCTP_SESSION_KEY`, and sets `CCTP_WORKER_ENABLED=true`.

Once the CCTP certification cases pass, certify the routes and copy the printed
line into the VPS `.env.production`:

```sh
node scripts/certify-testnet.mjs certify-routes --run-id=<run> --env-file=web/.env.local
```

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
- `/links` - manage payment links.
- `/withdraw` - withdraw to Stellar.
- `/history` - local payment history.
- `/pay/<username>` - payer checkout.
- `/pay/<username>/<slug>` - managed payment-link checkout.

## Environment

The web app reads public testnet configuration from `NEXT_PUBLIC_*` variables
and server-only secrets from plain variables. `web/.env.example` documents the
local development file (`web/.env.local`); `.env.production.example` documents
the file the VPS compose stack reads (`.env.production`).

Important server-only values:

- `MONGODB_URI` - MongoDB connection string.
- `CRON_SECRET` - long random bearer token that authorizes the internal
  `/api/cron/*` routes. Only the compose sidecars (and the local
  `pnpm cctp:worker` / `pnpm indexer:worker` loops)
  present it.
- `CHANNELS_API_KEY` - OpenZeppelin Relayer Channels key, when using Channels.
- `CCTP_OPERATOR_SECRET` - Stellar secret key for the CCTP intake operator.
- `CCTP_SESSION_KEY` - 32-byte hex AES-GCM key that seals cross-chain payment
  recovery context at rest. Deployment-specific; rotating it makes every
  unresolved session unreadable (see `docs/cctp-operations.md`).
- `CCTP_ROUTE_MANIFEST` - operator assertion of which CCTP source domains are
  `eligible` and `certified` for this pool/intake pair. `deploy-testnet.sh`
  writes an eligible-but-uncertified manifest;
  `certify-testnet.mjs certify-routes` flips `certified` once the CCTP
  certification cases pass.
- `CCTP_WORKER_ENABLED` - `true` lets `/api/cron/cctp-settlement` claim and
  settle sessions. The route gate refuses new payments while it is `false`.
- `CCTP_SOURCE_RPC_URLS` - optional JSON map of source domain to 1-3 HTTPS RPC
  URLs, overriding the public defaults.
- `CCTP_IRIS_TIMEOUT_MS` / `CCTP_IRIS_RPS` - Circle Iris request deadline and
  deployment-wide requests-per-second budget.
- `CIRCLE_API_KEY` - Circle API key for Iris attestation access if required.
- `PRIVY_APP_ID` / `PRIVY_APP_SECRET` - server-only Privy token verification.
- `OLIO_WALLET_DEPLOYER_SECRET` - low-float Stellar deployer for deterministic
  per-user C-addresses. Never expose it to the browser.

`NEXT_PUBLIC_PRIVY_APP_ID` is safe for the client bundle. Configure Google,
GitHub, and passkey login in separate development and production Privy apps;
register `https://auth.privy.io/api/v1/oauth/callback` with both OAuth providers.

Do not commit `web/.env.local`. The repository intentionally ignores `.env*`
files except `.env.example`.

### Background workers in development

Two internal routes do asynchronous work and are driven by an external loop
rather than by page traffic:

| Route | Loop | Cadence | Purpose |
|---|---|---|---|
| `POST /api/cron/pool-indexer` | `pnpm --filter web indexer:worker` | 60 s | Mirrors pool deposits and nullifiers into MongoDB. |
| `POST /api/cron/cctp-settlement` | `pnpm --filter web cctp:worker` | 15 s | Claims due cross-chain sessions and drains them (≈240 s budget per call). |

Both loops are the same script (`web/scripts/cron-loop.mjs`) the VPS sidecars
run, read `web/.env.local`, and target `OLIO_BASE_URL` (default
`http://localhost:3000`). Without the settlement loop the CCTP route gate reports
`worker_unavailable` and payers cannot start a cross-chain payment.

`pnpm --filter web dev:all` starts `next dev` and both loops in one terminal
(`concurrently`, prefixed `web` / `cctp` / `indexer`; Ctrl-C stops all
three).
Use `PORT=3005 OLIO_BASE_URL=http://localhost:3005 pnpm --filter web dev:all`
to run it on another port.

## Deployment

Production runs as a compose stack (`docker-compose.yml`) on a single VPS. The
services start in this order:

1. `migrate` runs `migrate-mongo up` against `MONGODB_URI` and exits. Migrations
   read `MONGO_POOL_STORAGE_SCOPE` from the environment, so the scoped
   `cctp_sessions__<pool>` indexes are created for
   the configured pool.
2. `web` starts only after `migrate` succeeds and is healthy once `/` responds.
3. `pool-indexer` and `cctp-settlement` sidecars start once
   `web` is healthy.
   Each runs `node web/scripts/<name>.mjs`, posts to its route with
   `CRON_SECRET`, and records a heartbeat file on every successful call. Their
   compose healthchecks fail when that heartbeat goes stale (3 min for the
   indexer, 6 min for settlement — one full drain budget plus slack), so
   `restart: unless-stopped` actually restarts a wedged loop.
4. `caddy` terminates TLS for `DOMAIN`.

```sh
docker compose up -d
docker compose ps
docker compose logs -f cctp-settlement
curl -s https://$DOMAIN/api/health/cctp | jq
```

`GET /api/health/cctp` is unauthenticated and reports worker liveness, active
and parked (`needs_attention`) session counts, and Iris circuit-breaker state.
It returns `503` when the worker heartbeat is stale, a session is parked, or a
circuit is flagged `denied`.

If `web` restarts, the sidecars log `unavailable` until it is back; they do not
need to be restarted. To add settlement capacity, run more sidecars — per-session
leases keep concurrent workers safe:

```sh
docker compose up -d --scale cctp-settlement=2
```

After deploying a new testnet pool contract, wait for `pool-indexer` to report
`status: synced` before relying on the dashboard mirror. Contract-id changes use
a new scoped mirror and fail closed if a collection is paired with another pool;
they never clear the old mirror, user keys, or other shared application
collections.

### CCTP route gate

`cctp.readiness` decides per source domain whether a payer may start a
cross-chain payment. The client queries it before enabling **Pay via CCTP** and
shows the mapped reason; the server enforces the same gate on `createSession`
and `prepareBurn`. Reason codes:

| Reason | State | Meaning / fix |
|---|---|---|
| `eligibility_not_confirmed` | `eligibility_unavailable` | No manifest, or the domain is not `eligible`. Run `deploy-testnet.sh` or edit `CCTP_ROUTE_MANIFEST`. |
| `route_not_certified` | `temporarily_unavailable` | Domain not `certified`, `CCTP_SESSION_KEY` missing, or `CCTP_WORKER_ENABLED != true`. Run `certify-testnet.mjs certify-routes` and set both variables. |
| `upstream_backoff` / `upstream_denied_investigate` | `temporarily_unavailable` | Iris circuit breaker is open (retry after `retryAfterMs`) or Circle returned 403/451 — investigate, then `cctp-sessions.mjs circuit-reset <domain>`. |
| `worker_unavailable` | `temporarily_unavailable` | No settlement heartbeat in the last 2 min. Check `docker compose ps cctp-settlement`. |
| `storage_not_ready` | `temporarily_unavailable` | `cctp_sessions` indexes missing. Run the `migrate` service. |
| `provider_fee_requires_gross_up` | `unsupported` | Circle charges a fee on this route; Olio does not gross up. |
| `unsupported_source` | `unsupported` | Domain is not one of `0, 1, 3, 5, 6`. |

Operational procedures — parked sessions, `CCTP_SESSION_KEY` rotation, backups,
and the pre-mainnet checklist — live in `docs/cctp-operations.md`.

## Identity verification (KYC/KYB)

A business profile can verify its owner as an individual, or the company plus
its owners and representatives, through Sumsub. Documents and selfies are
collected inside the provider's hosted experience; Olio keeps only the sanitized
evidence it needs. Olio — not the provider — decides eligibility: a GREEN result
with incomplete evidence, an unresolved company owner, a mismatched level or the
wrong environment never becomes an approval, and screening hits go to review
rather than an automatic rejection.

The webhook is authenticated with a separate secret and only wakes a durable
worker, which re-reads the provider's current state before applying any
revision-checked update; scheduled reconciliation runs whether or not a
notification ever arrives. An approved case issues an *Identity Verified*
credential that stays private until the owner publishes it at
`/business/<publicId>`; it is suspended automatically if eligibility regresses,
the linked Olio account changes, or the evidence goes stale.

`SUMSUB_MODE=off` by default. Scope, configuration and policy mapping are in
`docs/sumsub-verification.md`; running it, parked work and rollback are in
`docs/verification-operations.md`.

## Testnet Payment Notes

To test direct Stellar payments, the payer needs testnet USDC:

1. Connect a supported external Stellar payer wallet.
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
- Mainnet CCTP, Privy OAuth, wallet deployment, and account-migration hardening.
- Mainnet pool deployment under the rehearsed multisig admin process.
- Monitoring and alerting for the bridge sponsor, relay, and indexer.
- An account-merge sweep to recover residual XLM from cash-out bridges.
- Clear compliance policy for disclosure, abuse handling, and
  jurisdiction-specific requirements.
