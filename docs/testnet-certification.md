# Signed-fee testnet certification

This runbook certifies the signed client-fee implementation on Stellar Testnet. It does not authorize mainnet deployment, partner submission, deletion of legacy state, or movement of test funds. Keep the old pool, database, configuration, and signer available until every old note and committed asynchronous payment remains recoverable.

## 1. Preserve and isolate

1. Record the current network, registry, pool, intake, USDC SAC, public operator identities, pool balance, leaf count, indexer watermark, and pending CCTP sessions. Store secrets and user note material separately.
2. Back up the current database and private configuration, restore the backup into a disposable database, and verify the old application can still withdraw old notes.
3. Prefer a dedicated certification database URI. If one Mongo database must host multiple pools, set `MONGO_POOL_STORAGE_SCOPE` to the exact pool contract ID so each deployment uses separate pool-specific collections; the deployment tool does this automatically. The indexer fails closed on an unscoped pool mismatch and never erases the old mirror.
4. Use an isolated browser profile/storage area for certification.

## 2. Migrate and deploy

Run migrations only through the guarded wrapper. It requires both an explicit environment file and the exact database name:

```sh
pnpm --filter web migrate:status -- --migration-env=.env.certification --expected-database=olio_certification
pnpm --filter web migrate:up -- --migration-env=.env.certification --expected-database=olio_certification
pnpm --filter web migrate:status -- --migration-env=.env.certification --expected-database=olio_certification
```

Initialize the pool-scoped collections separately. This validates that the
database name, storage scope, and configured pool ID all match before creating
indexes:

```sh
pnpm --filter web storage:initialize -- \
  --env-file=.env.certification \
  --expected-database=olio_certification
```

Preview deployment without writes, reusing the existing registry by default:

```sh
FEE_RECIPIENT=G... scripts/deploy-testnet.sh \
  --registry-id C... \
  --env-file web/.env.certification \
  --manifest artifacts/testnet-certification/<run-id>/deployment.json \
  --dry-run
```

Remove `--dry-run` only after checking the exact treasury, deployer, operator, registry, database, and testnet budget. Resume an interrupted run with `--resume <manifest>`. A fresh registry requires the explicit `--new-registry` flag. The deployment command stages secrets in a mode-0600 pending file, validates pool signer and intake pairing, then activates the complete environment with one rename.

Rebuild/restart Next.js after activation. Run `pnpm --filter web readiness:testnet -- --channel=direct`; the process exits nonzero and prints bounded codes while any prerequisite is missing. Synchronize the new empty index once before expecting `INDEXER_NOT_READY` to clear. Readiness also requires an indexer watermark less than two minutes old; compare its published ledger with the live RPC ledger and confirm the on-chain leaf count equals the scoped `deposits` count.

To reset a confirmed-empty local pool mirror, preview the exact scope first and
then execute with an explicit backup directory. The command refuses to reset a
scope containing deposits or pending CCTP recovery records:

```sh
pnpm reset:testnet -- \
  --expected-database=olio \
  --allow-shared-database

pnpm reset:testnet -- \
  --expected-database=olio \
  --allow-shared-database \
  --execute \
  --confirm-scope=<exact-pool-contract-id> \
  --backup-dir=/absolute/path/to/scoped-backup
```

Never use the scoped reset as a production migration or as a substitute for
recovering an old mirror.

## 3. Automated release checks

```sh
cargo test --workspace
stellar contract build
bash -n scripts/deploy-testnet.sh
pnpm --filter web exec tsc --noEmit
pnpm --filter web exec vitest run fees feeQuote feeQuotes cctp stellarEvents poolIndexer
pnpm --filter web test
pnpm --filter web biome:check
pnpm --filter web build
git diff --check
```

Set `OLIO_TEST_MONGODB_URI` to a disposable MongoDB server to enable the real migration integration suite. It creates and drops uniquely named databases.

## 4. Live matrix

Create the evidence skeleton:

```sh
node scripts/certify-testnet.mjs init --run-id=<run-id> --revision=<git-revision> --diff-hash=<hash>
```

Use two recipient owners and controlled payers. For 100 USDC principal, verify 102 gross at 200 bps and 105 gross at 500 bps. The payer/intake loses gross, the pool gains exactly 100, the treasury gains 2 or 5, exactly one principal-sized note decrypts, and withdrawal returns the full 100 without a second Olio fee. Record network fees separately.

Run free-form and managed links for both tiers; wallet mismatch, rejection, insufficient gross, duplicate clicks, expiry, changed amount/account/recipient/policy; signed-field tampering and replay; pause/transfer/withdraw behavior; and indexer restart/concurrency. A simulated rejection must be labeled simulation evidence, not a submitted on-chain rejection.

For every enabled EVM source and Solana, verify the six-decimal gross burn, immutable hook/source binding, attested message, Stellar mint, intake deposit, restart recovery, and concurrent retry behavior. A failure after mint must recover without a second mint, fee, commitment, or use of unrelated intake funds. Disable any source that is not individually certified.


Evidence JSON may be attached to a case with:

```sh
node scripts/certify-testnet.mjs record --run-id=<run-id> \
  --case=DIR-01 --status=PASS --evidence=/absolute/path/to/sanitized-case.json
```

The recorder rejects confidential fields, invalid fee arithmetic, unrepresentable CCTP totals, and a `PASS` without transaction hashes and expected-versus-actual evidence.

## 5. Rollback rehearsal and release label

Stop new preview/issuance first while keeping withdrawals and committed CCTP recovery running. Confirm both old and new liabilities remain usable. Never point the signed-fee client at the old ABI as a rollback shortcut.

Every case remains `NOT RUN`, `BLOCKED`, `FAIL`, or `PASS`. Full certification requires all mandatory enabled paths to pass. If only direct Stellar payment passes, label the release “direct-only certified” and disable CCTP ingress. Missing funding, wallet signatures, Circle attestation availability is `BLOCKED` with an exact next action—not a mocked pass.
