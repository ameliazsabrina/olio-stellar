# Pool indexer: Goldsky event archive

This runbook covers the Goldsky pool-event archive: why it exists, how it is
wired, how to set it up, what each health status and refusal means, and what to
do when it breaks. It is optional. With `POOL_GAP_FILL_SOURCE=off` (the
default) the pool indexer behaves exactly as it did before Goldsky.

## Why it exists

The pool indexer reads contract events from Soroban RPC, which only keeps about
seven days of history on testnet. If the indexer is offline for longer, or a
spend event slips past the fallback windows, the nullifier mirror cannot be
proven complete. The indexer then writes `nullifiersComplete: false` and
`health: "degraded"` with the retention-gap message. Payment readiness treats
that gap-only degradation as a warning (`NULLIFIER_MIRROR_INCOMPLETE`: balances
may overstate), so payments keep working. The records gate does close
(`nullifiers_incomplete`, `pool_index_degraded`), so passport statements
return `records_on_hold`. Goldsky keeps a permanent copy of the pool's events,
so the indexer can fill that gap from the archive instead of marking the
mirror incomplete.

## How it works

```
Stellar testnet/mainnet
  -> Goldsky Turbo pipeline: one source (stellar_<net>.events), one SQL
     transform (pool_rows: pool events + heartbeat markers), one webhook sink
  -> POST /api/goldsky/pool-events (Authorization: Bearer <secret>)
  -> MongoDB pool_raw_events archive (idempotent upserts keyed by the RPC event id)
  -> pool indexer gap fill, only when the archive can vouch for the gap
```

- The pipeline has one source, the `stellar_<net>.events` dataset, and one
  transform, `pool_rows`, that emits two kinds of rows into one webhook sink:
  - `kind: "event"`: the pool contract's successful contract events.
  - `kind: "heartbeat"`: a marker. These are the events of the first
    transaction (`transaction_index = 0`) in every 60th ledger (about every 5
    minutes), from any contract other than the pool. A ledger whose first
    transaction emits no events just skips that heartbeat.
- Heartbeats come from the same stream, transform and sink as the pool events,
  so the heartbeat watermark (`lastLedger`) only proves progress of the stream
  that carries the pool events. That lets the archive vouch for a quiet range
  with no pool events. Within one webhook request the event rows are written
  before the watermark moves. Goldsky does not promise ordering across a
  pipeline restart, so the archive only vouches for ledgers at least 720
  ledgers (about 1 h) behind the watermark. That margin covers in-stream
  reordering.
- Every row carries `pool_id`, the pool the pipeline was rendered for. The
  webhook counts a heartbeat only when `pool_id` is the configured pool, and
  archives an event only when both `pool_id` and `contract_id` are the
  configured pool. Anything else is counted as `ignored`. A pipeline left
  running for an old pool therefore cannot move a new pool's watermark.
- The webhook rebuilds the Soroban RPC event id from the Goldsky id and uses it
  as `_id`, so archived rows and RPC rows are the same documents. The Goldsky
  id is kept as `goldskyId`. Writes are upserts, so replays and rewinds are
  safe.
- Gap fill runs inside the normal `POST /api/cron/pool-indexer` tick. It only
  uses the archive for a range when the archive's heartbeat watermark is at
  least 720 ledgers past the end of that range. Every archived `deposit`,
  `spend`, `withdraw` or `fee` row in the range must also parse with the
  mirror's own parser. Otherwise it refuses (see below): the nullifier mirror
  is marked incomplete, and the gap is kept as a pending gap and retried on
  every tick until the archive can vouch for it. Once every pending gap is
  filled, the mirror is marked complete again.

### Data format notes (testnet dataset `stellar_testnet.events`, checked 2026-10-16)

| Question | Answer |
|---|---|
| ScVal encoding | Tagged JSON. Bytes are lowercase hex, i128/u64 are decimal strings, u32 is a number, an address is a strkey, a map is `[{key, val}]`. `topics` is a JSON array string and `data` is a JSON string. A `bytes` value that is not whole hex pairs makes the row undecodable. |
| Event id | Goldsky: `<ledger>-<txhash>-op-<N>-event-<M>`. The archive rebuilds the RPC id as `pad19(TOID(ledger, transaction_index + 1, N)) + "-" + pad10(M)`. |
| `ledger_closed_at` | Naive UTC string with no `Z`. The webhook appends `Z`. |
| Heartbeat rows | Event rows from another contract, with `kind: "heartbeat"` and the same columns as events. Only `pool_id`, `ledger_sequence` and `ledger_closed_at` are used; the rest is dropped. The transform's `primary_key` is `id` for both kinds. |
| `_gs_op` | `"i"` on inserts. Anything other than `i` or `u` is treated as a correction. |
| Resource size | `resource_size: xs` validates. |

## Moving parts

| Piece | Where | Role |
|---|---|---|
| `web/scripts/goldsky-pipeline.mjs` | image / repo | Renders the pipeline YAML from the env file (network, pool id, start ledger) and a webhook URL. |
| `POST /api/goldsky/pool-events` | `web` service | Webhook sink. Checks the bearer secret before reading the body, caps the body at 4 MB while streaming it, writes rows into `pool_raw_events`, and advances the heartbeat watermark. |
| `pool_raw_events` | MongoDB | The archive. Created by migration `20261017090000-pool-raw-events.js`. |
| `indexer_state__<scope>` doc `{_id:"goldsky"}` | MongoDB | Archive watermark (`lastLedger`), `rejectedRows`, `lastRejectedAt`, and `correctionAt`. |
| `indexer_state__<scope>` doc `{_id:"pool"}` | MongoDB | The pool indexer's own state. Gap fill adds `pendingGaps` and `incompleteCauses` (see "Pending gaps"). |
| `GET /api/health/goldsky` | `web` service | Archive health. Always reports the archive's real status once the secret is set. HTTP `503` only when gap fill uses the archive and it is not healthy. |
| `web/scripts/goldsky-parity.mjs` | image / repo | Compares archived event ids with the mirror's event ids. |

## Setup

Use Node 22 for every script below (and for the parity and pool-storage
scripts). Node 20.11 has a bug that swallows a script's `--env-file=` argument
and exits 9. The Dockerfile already uses `node:22`.

### 1. Install and log in

```sh
curl https://goldsky.com | sh                        # CLI -> ~/.local/bin/goldsky
curl https://install-turbo.goldsky.com | sh          # Turbo extension -> ~/.goldsky/bin/turbo
goldsky login --token <API key>
```

The token is bound to its project. Do not pass `--project` together with
`--token`; the CLI rejects it.

### 2. Create the webhook secret

The sink authenticates with an `httpauth` secret. Generate hex only: other
characters hit the `PROD_ENV_FILE` quoting problem.

```sh
openssl rand -hex 32          # copy the output as <hex>
goldsky secret create OLIO_GOLDSKY_WEBHOOK
#   type:   httpauth
#   header: Authorization
#   value:  Bearer <hex>
```

Put the same `<hex>` in `GOLDSKY_WEBHOOK_SECRET` (the app compares against the
bearer value, not the `Bearer ` prefix).

### 3. Pick the start ledger and write the env file

`GOLDSKY_PIPELINE_START_LEDGER` is the ledger the pipeline starts from. Set it
at or before the pool's first ledger (the deploy or `initialize` transaction).
A later value leaves a hole at the start of the archive that no gap fill can
cover (`archive_starts_late`).

The renderer reads the start ledger from the env file, so it must be there
**before** step 4. Put all three in `PROD_ENV_FILE` (or `.env.local` for a
local run), and in the env file you render from:

```sh
POOL_GAP_FILL_SOURCE=off
GOLDSKY_WEBHOOK_SECRET=<hex>
GOLDSKY_PIPELINE_START_LEDGER=<ledger>
```

They are harmless while the source is `off`: the webhook archives, and the
indexer never reads the archive. Deploy, so the webhook is live before the
pipeline starts delivering.

### 4. Render, validate, apply

Run from `web/` with Node 22. `<url>` must be reachable from Goldsky: the
production domain, or an ngrok URL for local testing.

```sh
node scripts/goldsky-pipeline.mjs \
  --env-file=.env.production \
  --url=https://<domain>/api/goldsky/pool-events \
  --out=../infra/goldsky/olio-pool-testnet.yaml

goldsky turbo validate ../infra/goldsky/olio-pool-testnet.yaml
goldsky turbo apply    ../infra/goldsky/olio-pool-testnet.yaml
```

The rendered file embeds the pool id and start ledger, so each environment and
each pool gets its own file.

### 5. Wait for the backfill

```sh
goldsky turbo list
goldsky turbo get <pipeline-name>              # wait for Status: ACTIVE
goldsky turbo logs <pipeline-name>
goldsky turbo inspect <pipeline-name> --print -n <node>   # Live Inspect
```

Live Inspect only works once `Status: ACTIVE`; it errors while Pending. A
backfill on the pipeline was slow in testing (about 1,000 ledgers a minute), so
a backfill from the pool's first ledger can take hours.

`/api/health/goldsky` reports the archive's real status while the source is
still `off` (HTTP 200 either way; read the `status` field). The backfill is
done when it shows `"status":"healthy"`, that is when `lastLedger` is within
720 ledgers of the chain tip. You can also read the watermark directly:

```sh
curl -s https://$DOMAIN/api/health/goldsky | jq
mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").findOne({_id:"goldsky"})'
```

Do not run parity or turn gap fill on before then.

### 6. Turn gap fill on

Flip one variable:

```sh
POOL_GAP_FILL_SOURCE=goldsky
```

The secret and the start ledger are required once the source is `goldsky`
(they are already set from step 3). Redeploy, then confirm the route returns
200 with `"status":"healthy"` and `"gapFillSource":"goldsky"`:

```sh
curl -s https://$DOMAIN/api/health/goldsky | jq
```

Roll out in this order: set the env file with `POOL_GAP_FILL_SOURCE=off`
(step 3) and deploy, render and apply the pipeline, wait for the backfill
(`healthy`), run parity, then switch to `goldsky` and redeploy.

**Wait for `healthy` and a clean parity run before switching to `goldsky`.**
A gap that arrives while the archive is still backfilling is refused
(`archive_behind`) and kept pending, so it is not lost: it fills on a later
tick once the backfill passes it. Until then the nullifier mirror is marked
incomplete. Parity is the real gate: switching earlier skips the check that
the archive has no holes.

## Health: `/api/health/goldsky`

```sh
curl -s https://$DOMAIN/api/health/goldsky | jq
```

Every response carries `gapFillSource` (`off` or `goldsky`). The HTTP status
is `503` only when `gapFillSource` is `goldsky` and the status is not
`healthy`. Otherwise it is `200` and the body holds the true status, so during
rollout (source `off`) a monitor must read `status`, not the HTTP code.

| Status | HTTP | Meaning | What to do |
|---|---|---|---|
| `disabled` | 200 | `GOLDSKY_WEBHOOK_SECRET` is unset, so the webhook cannot receive. The route does not look at the archive. | Nothing, unless you meant to run the archive. |
| `healthy` | 200 | Archive watermark (`lastLedger`) is within 720 ledgers of the chain tip, and no rejected rows or corrections. | Nothing. |
| `lagging` | 503 with source `goldsky`, else 200 | Archive watermark is more than 720 ledgers behind the tip. | Check `goldsky turbo get` / `logs`. A failed pipeline is the usual cause (see below). A normal backfill also shows as lagging until it catches up. |
| `degraded` | 503 with source `goldsky`, else 200 | `rejectedRows > 0`, or `correctionAt` is set. The archive can no longer be trusted for gap fill. | Investigate, then clear (see below). |
| `unavailable` | 503 with source `goldsky` (or an unreadable env), else 200 | The check itself failed: MongoDB or the RPC tip lookup threw. The route logs `[goldsky] health check failed: <message>`. | Check MongoDB and RPC reachability from the `web` service. |

`healthy` does not promise that every gap is fillable. Whether a given range
can be filled still depends on the indexer watermark and on the heartbeat
being 720 ledgers past the range. When the indexer's watermark is outside RPC
retention, it scans one of the fallback windows `[17280, 8000, 2000, 500]`
ledgers back from the tip. A window of `w` ledgers can only be vouched for
when the archive lag is at most `w - 720` ledgers: 16,560 for 17,280, 7,280
for 8,000, and 1,280 for 2,000. The 500-ledger window can never be vouched
for.

## Gap-fill refusals

A refusal is logged and returned as `gapFill` in the cron result. In the same
tick the indexer still advances `publishedLedger` to the latest ledger, writes
`nullifiersComplete: false` (and `health: degraded`), and records the gap in
`pendingGaps` on the `{_id:"pool"}` document. Every later tick retries each
pending gap with the same vouch rules (start ledger, 720-ledger heartbeat
margin, untrusted archive, corrected rows, undecodable rows). Fixing the cause
(waiting for the archive, clearing `rejectedRows`, fixing a row) is enough: the
next tick fills the gap, upserts its events and drops it from `pendingGaps`.
While a gap is pending, passport statements return `records_on_hold`.

The exception is a gap that also hides a deposit. Then the mirror's deposit
count falls short of the on-chain leaf count, and the tick throws
`DepositIndexGapError` before the watermark advances. Neither
`publishedLedger` nor `nullifiersComplete` is written (so the gap is not
recorded as pending either), and `health` is `degraded` with the deposit-gap
error. The next tick sees the same gap and tries the fill again, so it is
retried every tick until the fill succeeds. Meanwhile payments fail readiness
(`INDEXER_NOT_READY`, a 412), because that degradation is not the gap-only
one.

With `POOL_GAP_FILL_SOURCE=off` nothing changes from the pre-Goldsky indexer:
the gap is not recorded as pending, `nullifiersComplete: false` is sticky, and
recovery is the manual one below.

A separate case is `POOL_INDEXER_TOLERATE_RETENTION_GAP=true` (local dev
only; rejected in production and on mainnet). Then the watermark still
advances, but `nullifiersComplete` is not set to false and
`retentionGapToleratedAt` is stamped instead. The gap is not recorded as
pending and stays unfilled.

| `gapFill` | Meaning | Clears when |
|---|---|---|
| `off` | `POOL_GAP_FILL_SOURCE` is not `goldsky`. The gap is burnt, not pended. | Never by itself; see "Recovering a burnt gap". |
| `archive_starts_late` | `GOLDSKY_PIPELINE_START_LEDGER` is greater than the gap's first ledger, so the archive does not reach back far enough. | A pipeline that starts earlier has backfilled past the gap and `GOLDSKY_PIPELINE_START_LEDGER` is lowered to match (redeploy). |
| `archive_untrusted` | `rejectedRows > 0` or `correctionAt` is set. | You investigate and clear it (see "Clearing `degraded`"). |
| `archive_behind` | The archive watermark is less than the gap's last ledger + 1 + 720. | The archive catches up. No action needed. |
| `corrected_rows` | A row in the gap range has `correctedAt` set (see "Rows flagged `correctedAt`"). | Each stamped row is cleared or deleted. |
| `archive_undecodable` | A row in the range could not be decoded into a pool event (bad JSON, an unsupported tag, bytes that are not hex), or a `deposit` / `spend` / `withdraw` / `fee` row decodes but the mirror's parser rejects its payload. The log line names the row `_id` and its kind. | The row is fixed, or re-archived correctly by a re-backfill. |

A successful fill of the current gap returns `"gapFill":"filled"` and logs
`retention gap filled from Goldsky`. A pending gap that fills on a later tick
logs `pending retention gap filled from Goldsky: ledgers <from>-<to>`.

### Pending gaps

The `{_id:"pool"}` document in `indexer_state__<scope>` carries:

- `pendingGaps`: `[{ fromLedger, toLedger, firstSeenAt, lastReason }]`, the
  inclusive ledger ranges still unfilled. Overlapping or adjacent ranges are
  merged. `lastReason` is the most recent refusal for that range. The field is
  removed once the list is empty.
- `incompleteCauses`: `["retention_gap"]` when `nullifiersComplete` is false
  only because of pending gaps. When every pending gap is filled, the indexer
  sets `nullifiersComplete: true` again and removes both fields.

If `nullifiersComplete` is false **without** `incompleteCauses`, the cause is
not a pending gap: a gap burnt while the source was `off`, or a mirror marked
incomplete before pending gaps existed. Filling pending gaps never clears
that; only the operator reset below does.

The cron result reports `pendingGaps` (ranges still pending after the tick)
and `pendingGapsFilled` (ranges filled this tick) whenever either is non-zero.
To inspect:

```sh
mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").findOne({_id:"pool"}, {nullifiersComplete:1, incompleteCauses:1, pendingGaps:1, retentionGapFilledAt:1})'
```

A gap stuck on the same `lastReason` for longer than an archive catch-up takes
needs the action in the table above.

### Recovering a burnt gap

This applies only when `nullifiersComplete` is false without
`incompleteCauses` (see above). A refused gap with gap fill on needs none of
it. Do this with `POOL_GAP_FILL_SOURCE=goldsky` and `/api/health/goldsky`
showing `healthy`. Every mirror write is an idempotent upsert, so rescanning
ledgers that were already indexed is safe.

1. **Rewind the indexer watermark.** In `indexer_state__<scope>`, document
   `{_id: "pool"}`, set `publishedLedger` to a ledger that is at or after
   `GOLDSKY_PIPELINE_START_LEDGER` and at or before the start of the burnt
   gap (the last ledger you know was fully indexed). The refused tick logs
   `retention gap: watermark ledger <N>, RPC resumed at <M>`; the gap is
   ledgers N through M-1, so `N - 1` (or the start ledger) is a safe value.
   Rewinding further than needed only costs a bigger scan. The next tick
   reads from `publishedLedger`, sees the gap again, and tries the fill.

   ```sh
   mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").updateOne({_id:"pool"}, {$set:{publishedLedger:<ledger>}})'
   ```

2. **Re-run the cron:** `POST /api/cron/pool-indexer` with the `CRON_SECRET`
   bearer (or wait for the sidecar tick). Expect `"gapFill":"filled"` and the
   `retention gap filled from Goldsky` log line. If it refuses, the gap is now
   pending and retried every tick; fix the cause and wait until `pendingGaps`
   is gone. No second rewind is needed.
3. **Clear the sticky flag.** Filling the gap does not reset an unexplained
   `nullifiersComplete: false`. Clear it with
   `web/scripts/pool-indexer-reset-gap.mjs`. Run it from `web/` with Node 22
   after the fill succeeded and `pendingGaps` is gone:

   ```sh
   node scripts/pool-indexer-reset-gap.mjs --env-file=.env.production --expected-database=olio            # dry run
   node scripts/pool-indexer-reset-gap.mjs --env-file=.env.production --expected-database=olio --execute  # apply
   ```

   Flags: `--env-file`, `--expected-database`, `--allow-shared-database`,
   `--execute` (without it the script is a dry run). It **refuses outside
   testnet** (`NEXT_PUBLIC_STELLAR_NETWORK` must be `testnet`; the script says
   mainnet gaps need a full resync), refuses while the indexer lease is held,
   and refuses unless the deposit mirror holds every published leaf. It is an
   operator assertion that no spend was missed. After a verified fill from the
   archive that assertion holds, but the script cannot tell the difference, so
   check `retentionGapFilledAt` on the `{_id:"pool"}` document first. The
   reset also removes `pendingGaps` and `incompleteCauses` (the dry run lists
   any pending gaps it would abandon), so never run it while a gap is still
   pending. Payment readiness rechecks within 30 seconds.

On mainnet there is no supported reset: the script refuses, so a gap burnt
while gap fill was `off` needs a full resync of the mirror. Gaps refused with
gap fill on are retried and need no reset.

## Clearing `degraded`

`rejectedRows` counts rows the webhook could not parse. `correctionAt` is set
when Goldsky sends a row whose `_gs_op` is not an insert or update.

The webhook logs one warning per batch that had rejected rows:
`[goldsky] <n> rejected row(s) in batch: id=<row id> kind=<kind> at <field paths>; ...`.
It names the claimed id and kind and the fields that failed validation, never
the payload. It also increments `rejectedRows` and sets `lastRejectedAt` in
`indexer_state__<scope>` `{_id:"goldsky"}` (and `correctionAt` for
corrections). Use those, and `goldsky turbo logs <pipeline-name>`, to find out
what was sent.

A rejected row is dropped with a `200`, so Goldsky never resends it, and the
heartbeat keeps moving past it. Treat it as a possible permanent hole in the
archive until parity proves otherwise. Parity only covers
`[start, min(archive watermark - 720, publishedLedger)]`, so it cannot see a
hole younger than about 720 ledgers (roughly 1 h). Before running parity and
clearing:

1. Read the state document. Note the exact `lastRejectedAt` and `correctionAt`
   values and record the current `lastLedger` as `W0`. Confirm
   `lastRejectedAt` is no longer moving (if it still is, the cause is ongoing:
   fix it first).
2. Wait until the archive `lastLedger` is at least `W0 + 780` (720 plus one
   60-ledger heartbeat step; about 1 h after `lastRejectedAt`, longer if
   heartbeats were skipped) **and** the pool document's `publishedLedger` is
   past `W0 + 60`. Until then a hole at the rejection is outside the parity
   window.
3. Run the parity script (below). It must pass: `missingFromArchive` and
   `legacyByTxHash.missingFromArchive` empty. `missingFromMirror` may only
   list explained admin events.
4. Only then reset the counters, filtering on the values you read at W0 so a
   newer rejection is not wiped:

   ```sh
   mongosh "$MONGODB_URI" --eval 'db.getCollection("indexer_state__<scope>").updateOne({_id:"goldsky", lastRejectedAt: ISODate("<lastRejectedAt read at W0>")}, {$set:{rejectedRows:0}, $unset:{correctionAt:"", lastRejectedAt:""}})'
   ```

   If `correctionAt` was set at W0, add `correctionAt: ISODate("<value read at W0>")`
   to the filter. If `lastRejectedAt` was unset at W0 (a correction only), use
   `lastRejectedAt: {$exists: false}` instead. A `matchedCount` of `0` means a
   newer rejection or correction arrived after W0: start again from step 1.

If parity fails, do not clear. See the remedy under "Parity script".

Once the counters are cleared, the next tick retries any gap pending with
`archive_untrusted` and fills it if the archive can now vouch.

### Rows flagged `correctedAt`

A correction (`_gs_op` other than `i`/`u`) does not delete anything. It stamps
`correctedAt` on the matching `pool_raw_events__<scope>` row (it never creates
one). Clearing `correctionAt` in the state document does not remove that
stamp, and gap fill keeps returning `corrected_rows` for any gap range that
contains a stamped row. After parity is clean, find them and decide each:

```sh
mongosh "$MONGODB_URI" --eval 'db.getCollection("pool_raw_events__<scope>").find({correctedAt:{$exists:true}}, {ledger:1,txHash:1,correctedAt:1}).toArray()'
```

Stellar has no reorgs, so a correction is unexpected. Check each `txHash` on
an explorer. If the event is real, clear the stamp:
`updateOne({_id:"<id>"}, {$unset:{correctedAt:""}})`. If the transaction does
not exist on chain, delete the row. Only then will a fill covering that
ledger range go through.

## Parity script

Compares the archive with the live mirror, event by event, over the window
where both are trusted:
`[GOLDSKY_PIPELINE_START_LEDGER, min(archive watermark - 720, publishedLedger)]`.

```sh
cd web
node --env-file=.env.production scripts/goldsky-parity.mjs \
  --env-file=.env.production --expected-database=olio
```

It diffs **event ids**, not transactions: a transaction carries several events
(a deposit and its fee, a spend and its withdraw), so a tx-hash match would
hide a missing event inside a matched transaction. The archive side is the
`_id` of every `pool_raw_events` row in the window. The mirror side is
`deposits.eventId`, `spent_nullifiers.eventId`, `withdrawals.eventId` and
`pool_fees._id`.

Output fields:

- `archiveEvents` / `mirrorEvents`: the number of event ids on each side.
- `missingFromArchive`: mirror event ids the archive lacks. This is a real
  problem.
- `legacyByTxHash`: older mirror docs without an `eventId` (early deposits)
  can only be matched by transaction. `compared` is how many there are, and
  `missingFromArchive` lists their transaction hashes that have no archived
  event at all.
- `missingFromMirror`: archived event ids the mirror lacks, grouped by the
  event's first topic (for example `pause`, `upgrade`, `gov_*`). These are
  informational: the mirror only indexes `deposit`, `spend`, `withdraw` and
  `fee`. A `deposit`, `spend`, `withdraw` or `fee` entry here deserves a look.

It exits `1` on a missing state document, on an empty window, when the
archive has 0 events in the window, when `missingFromArchive` is non-empty, or
when `legacyByTxHash.missingFromArchive` is non-empty. It exits `0` otherwise,
whatever `missingFromMirror` holds.

When parity fails because of `missingFromArchive`: the pipeline missed events
(wrong start ledger, a failed period, or rejected rows). Do not enable gap
fill, and do not clear `rejectedRows` / `correctionAt`: the archive has a hole
and a dropped row is never resent. The remedy is to re-backfill the archive:
delete the pipeline (`goldsky turbo delete <name>`) and apply a new one under
a **new name** from `GOLDSKY_PIPELINE_START_LEDGER` (the renderer derives the
name, `olio-pool-<network>-<pool prefix>`, so edit the `name:` line of the
rendered YAML by hand, e.g. append `-2`; a fresh name starts with no
checkpoint, and the webhook's upserts make the replay safe).

During any re-backfill or replay keep `POOL_GAP_FILL_SOURCE=off`. The
watermark is a `$max`, so it stays at the old high value while the replay
runs from the start ledger: `/api/health/goldsky` keeps showing `healthy` and
the watermark does not show when the replay is done. Parity is the only gate.
Wait for the replay to pass the end of the hole (watch `goldsky turbo get` /
`logs`), rerun parity until it passes, and only then clear the counters.

The script loads the ids in the window into memory. That is fine for a pool
of this size; revisit it if the pool grows to millions of events.

## Failed pipeline, and the webhook status codes

How Goldsky treats the webhook's response:

| Response | Cause | Goldsky behaviour |
|---|---|---|
| `200` | Rows archived (or counted as ignored or rejected). | Continues. |
| `401` | Wrong or rotated secret. Checked before the body is read. | Permanent failure: the pipeline FAILS and stops delivering. |
| `400` | Body could not be parsed as JSON. | Permanent failure. |
| `413` | Body larger than 4 MB, by `content-length` or while streaming a chunked body. | Permanent failure. |
| `503` | `GOLDSKY_WEBHOOK_SECRET` unset, the server env cannot be read, the body stream failed, or Mongo failed. | Retried forever with backoff. A server outage loses nothing. |

For a pipeline failed by a 4xx: fix the cause, then run
`goldsky turbo apply <file>` again. The checkpoint resumes from where it
stopped and nothing is lost.

### Rotating the secret

The secret lives in two places that must change together.

1. `openssl rand -hex 32`.
2. Update the Goldsky secret `OLIO_GOLDSKY_WEBHOOK` (value `Bearer <new hex>`).
3. Update `GOLDSKY_WEBHOOK_SECRET` in `PROD_ENV_FILE` and redeploy.
4. `goldsky turbo apply <file>` again so the pipeline picks up the new value.

Between steps 2 and 3 the webhook returns 401 and the pipeline fails. That is
fine as long as step 4 follows: the checkpoint resumes.

## Pool redeploy vs in-place upgrade

- A pool **redeploy** (a new contract id) needs a new pipeline and a new
  `GOLDSKY_PIPELINE_START_LEDGER`. In order:
  1. Set `POOL_GAP_FILL_SOURCE=off` and keep it off until the new archive
     passes parity.
  2. **Delete the old pipeline** (`goldsky turbo delete <name>`). This is
     required, not optional. Its rows carry the old `pool_id` and the webhook
     ignores them, but it keeps posting to the same URL, uses worker hours,
     and fills the `ignored` counts so they stop meaning anything.
  3. Update `NEXT_PUBLIC_OLIO_POOL_ID` and `GOLDSKY_PIPELINE_START_LEDGER` in
     the env file, deploy, then re-render, validate, and apply the new
     pipeline (setup steps 3 and 4).
  4. Wait for the backfill (`healthy`) and run parity. Only then consider
     switching the source back to `goldsky`.
- An in-place **`upgrade`** keeps the contract id. Nothing changes: no new
  pipeline, no new start ledger.

## Cost

One `xs` pipeline (0.5 worker) is about 365 worker-hours a month. The Scale
plan includes 750 worker-hours and 1M writes a month. Heartbeats mark about
43k ledgers a month, and each marker is every event of that ledger's first
transaction (usually a handful), so expect on the order of 100k-200k
heartbeat rows a month. A single pipeline stays inside the free tier.

## Rollback

Set `POOL_GAP_FILL_SOURCE=off` and redeploy. Behaviour is identical to the
pre-Goldsky indexer. The webhook keeps archiving harmlessly; to stop that too,
delete the pipeline (`goldsky turbo delete <name>`). Nothing else depends on
the archive.

## Pre-enable checklist

- [ ] Node 22 for every script; `GOLDSKY_WEBHOOK_SECRET` is hex only.
- [ ] `OLIO_GOLDSKY_WEBHOOK` secret in Goldsky matches `Bearer <GOLDSKY_WEBHOOK_SECRET>`.
- [ ] `GOLDSKY_PIPELINE_START_LEDGER` is at or before the pool's first ledger, and was in the env file when the pipeline was rendered.
- [ ] Only one pipeline exists for this pool (`goldsky turbo list`); any pipeline for an old pool is deleted.
- [ ] `goldsky turbo get` shows `Status: ACTIVE` and `/api/health/goldsky` shows `"status":"healthy"`.
- [ ] `goldsky-parity.mjs` exits 0: `missingFromArchive` and `legacyByTxHash.missingFromArchive` are **empty**, and every `missingFromMirror` entry is an explained admin event.
- [ ] `rejectedRows` is 0, `correctionAt` is unset, and no `pool_raw_events__<scope>` row has `correctedAt`.
- [ ] After switching `POOL_GAP_FILL_SOURCE=goldsky`, `/api/health/goldsky` returns 200 with `healthy` and `"gapFillSource":"goldsky"`.
- [ ] An external monitor polls `/api/health/goldsky` and alerts on non-200; during rollout (source `off`) it alerts on a `status` other than `healthy`.
