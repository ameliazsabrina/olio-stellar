# CCTP settlement operations

This runbook covers the cross-chain (CCTP) settlement worker on the VPS compose
stack: how it runs, how to see what it is doing, what to do when a session is
parked, and what must be true before the route is opened on mainnet.

## Moving parts

| Piece | Where | Role |
|---|---|---|
| `POST /api/cron/cctp-settlement` | `web` service | Claims due sessions under a 10-minute lease and drains them for up to ~240 s per call. Writes `worker:<pool>` heartbeat (2-minute lease) at start, between sessions, and every 30 s while settling. A session still waiting on source finality / Iris attestation (`pending`) is re-polled every ~10 s for its first 30 minutes; only real faults, or a transfer older than that, use exponential backoff (5 s → 5 min). |
| `cctp-settlement` sidecar | compose | `node web/scripts/cctp-worker.mjs`: posts to the route every `CCTP_WORKER_INTERVAL_MS` (5 s), writes a heartbeat file on success. Its healthcheck fails after 6 minutes without a successful call. |
| `cctp_sessions__<pool>` | MongoDB | One document per accepted quote. Never expires; recovery context is sealed with `CCTP_SESSION_KEY`. |
| `cctp_coordination` | MongoDB | Worker heartbeat, per-domain Iris circuit breaker (`iris:circuit:<domain>`), request locks, shared rate budgets, response cache. TTL-expired except the heartbeat/circuit rows. |
| `GET /api/health/cctp` | `web` service | Public liveness summary: worker heartbeat, active / parked session counts, circuit state. `503` when degraded. |
| `web/scripts/cctp-sessions.mjs` | image | Operator CLI: `list`, `inspect`, `requeue`, `circuits`, `circuit-reset`. |

Session stages, in order: `awaiting_signature` → `source_submitted` (or
`submission_unknown`) → `confirming_source` → `awaiting_attestation` →
`minting` → `minted` → `depositing` → `completed`. `needs_attention` is a
parking stage: the worker never claims it.

## Watching it

```sh
docker compose ps
docker compose logs -f cctp-settlement
docker compose logs -f web | grep -E '\[cctp-(worker|iris)\]'
curl -s https://$DOMAIN/api/health/cctp | jq
```

Every settled attempt logs one `[cctp-worker]` line with `outcome`, `latencyMs`
and `ageMs`; every Iris call logs `[cctp-iris]` with `outcome` and `latencyMs`.
The health route is the thing to put behind an external uptime monitor; nothing
else on the VPS alerts.

Minimal alert loop until a real monitor exists:

```sh
docker compose logs -f cctp-settlement web | grep -E 'needs_attention|"outcome":"binding"|unavailable'
```

## Parked sessions (`needs_attention`)

A session is parked when:

- the worker raised `binding` — more than one source message or log matches the
  quote, which must never be auto-resolved; or
- the session has been pending for more than 24 h since creation (or since its
  last requeue).

While parked, `feeQuotes.readiness` reports a `CCTP_SESSIONS_NEED_ATTENTION`
warning, `/api/health/cctp` returns `503`, and the payer's page shows "Payment
needs attention. Recovery remains saved." Funds are never lost: the payer's
recovery record and the sealed server context both survive.

Triage on the VPS (the image contains the CLI and `.env.production` carries
`CCTP_SESSION_KEY`):

```sh
docker compose run --rm web node web/scripts/cctp-sessions.mjs list
docker compose run --rm web node web/scripts/cctp-sessions.mjs inspect <sessionId>
docker compose run --rm web node web/scripts/cctp-sessions.mjs inspect <sessionId> --reveal
```

`inspect` never prints the sealed blob or capability hash; `--reveal` decrypts
the recovery context and prints the recipient username, owner, and quote
amounts, but never the note salt.

Decide per session:

1. `errorCode: binding` — look up `sourceTxHash` on the source explorer. If the
   payer really did burn twice against one quote, one burn settles and the other
   needs a manual refund path; do not requeue until the duplicate is understood.
   If the duplicate was a reorged/removed log, requeue.
2. Aged out with a transient `errorCode` (`upstream`, `timeout`, `transport`,
   `throttled`, `settlement_pending`) — confirm Iris and the source RPC are
   healthy (`circuits` below), then requeue.
3. `sourceTxHash` missing after 24 h on an EVM domain — the payer never
   broadcast, or broadcast on a chain other than the quoted one. Leave parked;
   the payer's browser will keep the recovery record.

```sh
docker compose run --rm web node web/scripts/cctp-sessions.mjs requeue <sessionId>
```

`requeue` resets `attempts`, clears the error and any stale lease, stamps
`requeuedAt` (which restarts the 24 h escalation window), and returns the
session to `source_submitted` / `submission_unknown`. The next sidecar tick
picks it up.

## Stuck between `minted` and `depositing`

Symptom: the relay row sits at `state: minted` (USDC is already on the intake
contract), the session stays leased with its heartbeat refreshing, no
`operator:*` sequence lock exists in `cctp_coordination`, and the `web`
process is idle at ~0 % CPU. Nothing errors and nothing retries.

That is the deposit-proof step hanging, not the chain. `proveDeposit` runs
snarkjs inside the Next server for CCTP only; snarkjs's prover spawns worker
threads by re-executing its own `__filename`, which only works when the
package is loaded from `node_modules`, not from a webpack chunk. `snarkjs` is
therefore listed in `serverExternalPackages` in `web/next.config.mjs` — keep
it there. If the symptom reappears after a Next or snarkjs upgrade, check that
list first.

Recovery once the cause is fixed: restart `web` so the hung handler dies, then
either wait for the session lease to lapse (≤ 10 min) or clear it by hand:

```sh
docker compose run --rm web node web/scripts/cctp-sessions.mjs inspect <sessionId>
# once the old web process is gone:
mongosh "$MONGODB_URI" --eval 'db.getCollection("cctp_sessions__<POOL>").updateOne({_id:"<sessionId>", stage:{$in:["minting","minted"]}}, {$unset:{leaseOwner:"",leaseUntil:""}})'
```

The worker resumes from the relay checkpoint: it skips `receive_message`,
proves, and forwards to the pool. Never requeue-by-deleting the relay row —
that would replay the mint check against an already-consumed nonce.

## Iris circuit breaker

Each source domain has a breaker row. Failures back off exponentially (1 s →
5 min, jittered); the route gate reports `upstream_backoff` while it is open
and `upstream_denied_investigate` permanently after a 403/451 until an
operator clears it. A successful request resets `failures` but deliberately
keeps `denied: true`.

```sh
docker compose run --rm web node web/scripts/cctp-sessions.mjs circuits
docker compose run --rm web node web/scripts/cctp-sessions.mjs circuit-reset <domain>
```

Only reset after confirming with Circle why the sandbox refused the request
(key, IP, or policy).

## Locally

```sh
pnpm --filter web cctp:worker
pnpm --filter web cctp:sessions list
```

Both read `web/.env.local`; set `OLIO_BASE_URL` if the dev server is not on
`http://localhost:3000`.

## Scaling

Leases make concurrent workers safe: `findOneAndUpdate` claims one session per
owner, checkpoints are fenced on `leaseOwner`, and the drain loop stops as soon
as a claim returns nothing. Running two sidecars roughly doubles throughput
during a backlog and costs nothing when idle:

```sh
docker compose up -d --scale cctp-settlement=2
```

Both replicas share the `worker:<pool>` heartbeat, so the route gate stays open
as long as any replica is alive. Do not scale `pool-indexer`; it is idempotent
but serialises on a single watermark.

## `CCTP_SESSION_KEY` rotation

The key seals recovery context with the session id as AAD. Rotating it makes
every session that has not reached `completed` undecryptable by the worker,
which surfaces as `settlement_pending` retries and eventual parking. Rotation
procedure:

1. `cctp-sessions.mjs list --stage=active` must be empty and
   `list --stage=needs_attention` must be resolved or accepted as lost.
2. Set `CCTP_WORKER_ENABLED=false`, `docker compose up -d web`, and confirm
   `/api/health/cctp` shows no active sessions.
3. Replace `CCTP_SESSION_KEY` (`openssl rand -hex 32`) in `.env.production`.
4. Set `CCTP_WORKER_ENABLED=true`, `docker compose up -d web cctp-settlement`.

There is no dual-key window; do not rotate with sessions in flight.

## Backups

`cctp_sessions__<pool>` is the only durable record that a payer's burn is owed
a deposit, and it never expires. Include it (and `cctp_relays__<pool>`, which
records the mint/deposit checkpoints) in the MongoDB backup, and keep the
matching `CCTP_SESSION_KEY` with the backup's secrets — a restored collection
without its key is unreadable. `cctp_coordination` is disposable.

## Pre-mainnet checklist

- [ ] `migrate` runs before `web` (compose `depends_on: service_completed_successfully`) and `MONGO_POOL_STORAGE_SCOPE` equals `NEXT_PUBLIC_OLIO_POOL_ID`.
- [ ] `CCTP_ROUTE_MANIFEST` pool/intake match the deployment; every `certified: true` domain has a PASS run under `artifacts/testnet-certification/<run>` referenced by `evidence`.
- [ ] `CCTP_SESSION_KEY` generated on the VPS, stored with the backup secrets, never reused from another environment.
- [ ] `CRON_SECRET` is long and random; only sidecars know it.
- [ ] `docker compose ps` shows `web`, `pool-indexer`, `cctp-settlement` healthy; `/api/health/cctp` returns `200`.
- [ ] `cctp-sessions.mjs list` is empty; `circuits` shows no `denied`.
- [ ] MongoDB backup schedule includes `cctp_sessions__*` and `cctp_relays__*`.
- [ ] An external monitor polls `/api/health/cctp` and alerts on non-200.
- [ ] Iris base URL, API key, and RPC URLs point at mainnet endpoints and `assertCctpTestnet` has been replaced by a mainnet certification gate.
- [ ] Rollback plan: `CCTP_WORKER_ENABLED=false` closes the route for new payments within one readiness cache window (30 s) without touching in-flight sessions.
