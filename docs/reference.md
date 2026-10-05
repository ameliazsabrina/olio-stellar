# Developer Reference

> **For developers.** This page is the one place we get technical — contract IDs,
> parameters, and build commands. If you're just here to get paid, you can safely
> skip it.

> These values are from the current **testnet** deployment. Regenerate them with
> `./scripts/deploy-testnet.sh <identity>`, which writes fresh IDs to
> `web/.env.local`. Treat the table below as an example, not a guarantee.

## Network

| Key | Value |
| --- | --- |
| Network | `testnet` |
| Network passphrase | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |

## Contract IDs (testnet)

| Contract | ID |
| --- | --- |
| `olio-registry` | `CAXBFQCZIIZ73RT6KVDBTZECQCDIDIRNAQWO5X4Q5RKI4RBDL7IMHFPW` |
| `olio-pool` | `CCV6AL2P3CYSF7FVRR4QEB5375TGX4VOXHEF3QI4QSZVJXV3O7VXWX53` |
| `olio-intake` (CCTP) | `CA3P6VWP3ZBC65GW6USZFTNIIQNBGAYJDDRJSQEQTX7TNOETMETD7RBE` |
| USDC Stellar Asset Contract | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

## Pool & privacy parameters

| Key | Value |
| --- | --- |
| Merkle tree depth | `20` |
| Proof system | Groth16 over BN254 |
| Hash | Poseidon (shared across circuit / contract / browser) |
| Withdraw public signals | `[root, nullifier, recipient, amount]` |
| Transfer public signals | Circuit retained, but pool transfer entry point is gated off in this deployment |
| Olio fee policy v2 | Allowed rates `200` or `500` bps; `floor(principal * bps / 10_000)` |
| Fee quote format | v1 canonical Soroban XDR, SHA-256, Ed25519 authorization |
| Pool fee event | payer, treasury, principal, rate, fee, total, policy version, and opaque quote ID |

## CCTP

| Key | Value |
| --- | --- |
| Stellar CCTP domain | `27` |
| Olio hook binding | v3 canonical immutable payment-binding digest |
| Solana USDC mint (testnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Testnet source chains | Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Avalanche Fuji, Solana Devnet |

## Server-only secrets

Set in `web/.env.local` (never committed):

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (users, links, indexer cache) |
| `CHANNELS_API_KEY` | OpenZeppelin Relayer (Channels) key for gasless submission |
| `CCTP_OPERATOR_SECRET` | Stellar secret for the CCTP intake operator/relay |
| `CIRCLE_API_KEY` | Circle API key for Iris attestation access |
| `CRON_SECRET` | Bearer token for the internal `/api/cron/*` routes driven by the settlement and indexer loops |
| `CCTP_SESSION_KEY` | 32-byte hex key sealing cross-chain recovery context; deployment-specific, see [CCTP settlement operations](cctp-operations.md) |
| `CCTP_ROUTE_MANIFEST` | JSON assertion of eligible/certified CCTP source domains for this pool and intake |
| `CCTP_WORKER_ENABLED` | `true` to let the settlement worker claim sessions; the route gate closes when `false` |
| `CCTP_SOURCE_RPC_URLS` | Optional JSON map of source domain → HTTPS RPC URLs |
| `CCTP_IRIS_TIMEOUT_MS` / `CCTP_IRIS_RPS` | Iris request deadline and shared requests-per-second budget |
| `FEE_QUOTE_SIGNING_SECRET` | Dedicated Ed25519 pricing-authority seed; never expose to the browser |

## Prerequisites & build

* Rust with the `wasm32v1-none` target
* Stellar CLI 27+
* Node 20+, pnpm 10+
* circom 2 and snarkjs
* MongoDB

```sh
pnpm install                                  # web deps
stellar contract build                        # contracts
cargo test -p olio-registry -p olio-pool -p olio-intake
cd circuits && npm install && ./build.sh      # circuits + Soroban VKs
./scripts/deploy-testnet.sh alice             # deploy to testnet
```

## Useful app routes

| Route | Purpose |
| --- | --- |
| `/` | Landing & onboarding |
| `/dashboard` | Private balance overview |
| `/links` | Manage payment links |
| `/withdraw` | Withdraw to Stellar |
| `/history` | Local payment history |
| `/pay/<username>` | Payer checkout |
| `/pay/<username>/<slug>` | Managed payment-link checkout |
