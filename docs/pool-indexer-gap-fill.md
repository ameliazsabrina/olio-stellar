# Pool indexer: retention-gap fill from the ledger data lake

This runbook covers how the pool indexer recovers events that Soroban RPC no
longer serves: where the data comes from, how a fill runs, what each refusal
means, and what to do when one sticks. It needs no account, secret or paid
service. It replaced the Goldsky event archive on 2026-10-22.

## Why it exists

The pool indexer reads contract events from Soroban RPC, which keeps about
seven days of history. If the indexer is offline for longer, or a spend event
slips past the fallback windows, the nullifier mirror cannot be proven
complete. The indexer then writes `nullifiersComplete: false` and
`health: "degraded"` with the retention-gap message. Payment readiness treats
that gap-only degradation as a warning (`NULLIFIER_MIRROR_INCOMPLETE`:
balances may overstate), so payments keep working. The records gate does
close (`nullifiers_incomplete`, `pool_index_degraded`), so passport statements
return `records_on_hold`. The data lake holds every ledger, so the indexer
reads the missing ledgers from it instead of leaving the mirror incomplete.

## Where the data comes from

The AWS public blockchain dataset holds a Galexie export of every Stellar
ledger, free to read without an AWS account:

| Network | Location |
|---|---|
| testnet | `s3://aws-public-blockchain/v1.1/stellar/ledgers/testnet/<reset date>/` (newest dated folder with a `.config.json`) |
| mainnet | `s3://aws-public-blockchain/v1.1/stellar/ledgers/pubnet/` |

Each ledger is one zstd-compressed `LedgerCloseMetaBatch` XDR file, about
16 KB on testnet today, named `<FFFFFFFF-partitionStart>--<start>-<end>/<FFFFFFFF-ledger>--<ledger>.xdr.zst`
with 64,000 ledgers per partition. The indexer reads `.config.json` once per
process and refuses unless its network passphrase is this app's, compression
is `zstd`, and there is one ledger per file. `POOL_DATALAKE_URL` points it at
another Galexie export instead (a self-hosted bucket, say); the bucket listing
is then skipped.

A file is the whole ledger, every transaction on the network, so a fill
downloads far more than the pool's few events. Measured from a dev machine on
2026-10-22: 40 to 100 ledgers a second at 32 parallel downloads, 4 ms of CPU
to decode each; 64 or more parallel downloads hit connect timeouts. The VPS
may differ.

## How a fill works

```
POST /api/cron/pool-indexer tick (pool lease held)
  -> RPC getEvents from the watermark; a start past the watermark is a gap
  -> scan the gap's unread ledgers from the data lake, 256 at a time,
     32 downloads in parallel, until the 25 s per-tick budget runs out
  -> pool events of each chunk upserted into pool_raw_events__<scope>,
     then the chunk recorded in indexer_state__<scope> {_id:"datalake"}
  -> once every ledger of the gap is recorded: read the gap's events back,
     run them through the mirror parsers, upsert them into the mirror
```

- **Resumable.** Scan progress lives in `scannedRanges` on the
  `{_id:"datalake"}` document, not in the pool state, so it survives a tick
  that throws. Each tick scans for up to 25 s, then the sidecar sleeps 60 s,
  so a 7-day gap (~121k ledgers, ~2.2 GB) takes about 1 to 3 hours to fill
  at the rates below; each tick reports `"gapFill":"scanning"` until the last
  ledger is read. A one-day gap takes 10 to 25 minutes.
- **Checked.** Each file must hold exactly the requested ledger, its header
  hash must equal the SHA-256 of the header, and each ledger's
  `previousLedgerHash` must equal the hash of the ledger before it, across
  chunks and across ticks (`scannedRanges` keeps the hashes at both ends of
  every range). Only successful transactions' `contract` events from the pool
  contract are kept.
- **Same ids as RPC.** Event ids are rebuilt as
  `pad19(TOID(ledger, txIndex + 1, opIndex)) + "-" + pad10(eventIndex)`, so
  archived rows and RPC rows key the same documents and every write is an
  idempotent upsert.
- **Two SDKs.** Ledgers are decoded with `stellar-sdk-ledgers`, an alias of a
  newer `@stellar/stellar-sdk` than the app's, because a whole ledger fails to
  decode if any transaction in it uses XDR newer than the decoder. Only base64
  ScVals leave the decoder; the gap fill parses them with the app's own SDK.
  **After a protocol upgrade, bump the alias** in `web/package.json`. Until
  then, fills refuse with `ledger_undecodable` and stay pending.

## Refusals

A refusal is logged as `[datalake] gap fill refused (<reason>): <detail>` and
returned as `gapFill` in the cron result. In the same tick the indexer still
advances `publishedLedger` to the latest ledger, writes
`nullifiersComplete: false` (and `health: degraded`), and records the gap in
`pendingGaps` on the `{_id:"pool"}` document. Every later tick retries each
pending gap; once the cause is gone the next tick fills it, upserts its
events, and drops it from `pendingGaps`.

The exception is a gap that also hides a deposit. Then the mirror's deposit
count falls short of the on-chain leaf count, and the tick throws
`DepositIndexGapError` before the watermark advances, so the gap is not
recorded as pending. The next tick sees the same gap and resumes the scan
where the last one stopped. Meanwhile payments fail readiness
(`INDEXER_NOT_READY`, a 412) until the fill completes.

| `gapFill` | Meaning | Clears when |
|---|---|---|
| `off` | `POOL_GAP_FILL_SOURCE=off`. The gap is burnt, not pended. | Never by itself; see "Recovering a burnt gap". |
| `scanning` | The per-tick budget ran out with ledgers still unread. | The next ticks finish the scan. No action needed. |
| `datalake_unavailable` | A request timed out, failed twice, or got a non-404 HTTP error (S3 throttling, a network outage). | The bucket is reachable again. |
| `datalake_mismatch` | No usable `.config.json`, or it is for another network or format. | `POOL_DATALAKE_URL` (or the default lookup) points at the right export. After a testnet reset, check the newest dated folder exists. |
| `ledger_missing` | A ledger in the gap has no file. Usually the gap reaches back before the folder's first ledger (a testnet reset). | Never for a pre-reset ledger; otherwise once the export catches up. |
| `ledger_undecodable` | A file failed to decompress or decode, or holds another ledger, or its header hash is wrong. The log names the ledger. Usually XDR from a newer protocol. | Bump the `stellar-sdk-ledgers` alias and redeploy. |
| `ledger_chain_broken` | A ledger's `previousLedgerHash` does not match the ledger before it, inside a chunk or against a recorded range. | Investigate; then delete the `{_id:"datalake"}` document so the gap is re-read from scratch. |
| `event_undecodable` | A stored pool event decodes but its mirror parser rejects the payload, so filling would silently drop it. The log names the event id and kind. | The parser or the stored row is fixed. |

A successful fill returns `"gapFill":"filled"` and logs
`retention gap filled from the data lake: ledgers <from>-<to>, <n> events`. A
pending gap that fills on a later tick logs
`pending retention gap filled from the data lake`.

### Pending gaps

The `{_id:"pool"}` document in `indexer_state__<scope>` carries:

- `pendingGaps`: `[{ fromLedger, toLedger, firstSeenAt, lastReason }]`, the
  inclusive ledger ranges still unfilled. Overlapping or adjacent ranges are
  merged. The field is removed once the list is empty.
- `incompleteCauses`: `["retention_gap"]` when `nullifiersComplete` is false
  only because of pending gaps. When every pending gap is filled, the indexer
  sets `nullifiersComplete: true` again and removes both fields.

If `nullifiersComplete` is false **without** `incompleteCauses`, the cause is
not a pending gap (a gap burnt while the source was `off`, or a mirror marked
incomplete before pending gaps existed). Filling pending gaps never clears
that; only the operator reset below does.

```sh
mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").findOne({_id:"pool"}, {nullifiersComplete:1, incompleteCauses:1, pendingGaps:1, retentionGapFilledAt:1})'
mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").findOne({_id:"datalake"})'
```

### Recovering a burnt gap

This applies only when `nullifiersComplete` is false without
`incompleteCauses`. Every mirror write is an idempotent upsert, so rescanning
ledgers that were already indexed is safe.

1. **Rewind the indexer watermark.** In `indexer_state__<scope>`, document
   `{_id: "pool"}`, set `publishedLedger` to a ledger at or before the start of
   the burnt gap. The refused tick logged
   `retention gap: watermark ledger <N>, RPC resumed at <M>`; `N - 1` is a
   safe value. The next tick reads from `publishedLedger`, sees the gap again,
   and fills it from the data lake.

   ```sh
   mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").updateOne({_id:"pool"}, {$set:{publishedLedger:<ledger>}})'
   ```

2. **Let the ticks run** (or `POST /api/cron/pool-indexer` with the
   `CRON_SECRET` bearer) until the result shows `"gapFill":"filled"` and
   `pendingGaps` is gone.
3. **Clear the sticky flag** with `web/scripts/pool-indexer-reset-gap.mjs`,
   from `web/` with Node 22, after the fill succeeded and `pendingGaps` is
   gone:

   ```sh
   node scripts/pool-indexer-reset-gap.mjs --env-file=.env.production --expected-database=olio            # dry run
   node scripts/pool-indexer-reset-gap.mjs --env-file=.env.production --expected-database=olio --execute  # apply
   ```

   It refuses outside testnet, while the indexer lease is held, and unless the
   deposit mirror holds every published leaf. It also removes `pendingGaps`
   and `incompleteCauses`, so never run it while a gap is still pending.

On mainnet the reset script refuses, so a gap burnt while gap fill was `off`
needs a full resync of the mirror. Gaps refused with gap fill on are retried
and need no reset.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `POOL_GAP_FILL_SOURCE` | `datalake` | `off` restores the pre-archive behaviour (gaps are burnt). The retired value `goldsky` is read as `datalake`. |
| `POOL_DATALAKE_URL` | unset | Base URL of a Galexie export (the folder holding `.config.json`). Unset uses the AWS public bucket. |
| `POOL_INDEXER_TOLERATE_RETENTION_GAP` | `false` | Local dev only. Advances past a refused gap without marking the mirror incomplete. A gap still `scanning` is never tolerated: it stays pending until the scan finishes. |

## Retiring Goldsky

Migration `20261022090000-retire-goldsky-archive.js` deletes the Goldsky rows
(those with `goldskyId`) from `pool_raw_events__<scope>`, the
`{_id:"goldsky"}` watermark, and any `{_id:"datalake"}` scan record, so a
range scanned over Goldsky rows before the migration is read again. The webhook route `/api/goldsky/pool-events` and
`/api/health/goldsky` are gone, so a monitor polling the health route must be
removed, and any Goldsky pipeline still pointed at the webhook should be
deleted (`goldsky turbo list`, then `goldsky turbo delete <name>`) to stop its
billing. `GOLDSKY_WEBHOOK_SECRET` and `GOLDSKY_PIPELINE_START_LEDGER` are no
longer read and can be removed from `PROD_ENV_FILE`.
