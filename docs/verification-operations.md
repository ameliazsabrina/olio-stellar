# Verification operations

This runbook covers the Sumsub verification worker on the compose stack: how it
runs, how to watch it, what each parked state means, what an operator may and
may not do, and how to roll back. The integration itself is described in
[Identity verification (Sumsub)](sumsub-verification.md).

## Moving parts

| Piece | Where | Role |
|---|---|---|
| `POST /api/cron/verification-reconciliation` | `web` service | Drains queued notifications, then re-checks every case whose `reconcileAt` is due, for up to ~240 s per call. Refreshes the `worker:verification` heartbeat in `verification_coordination`. |
| `verification-reconciliation` sidecar | compose | `node web/scripts/verification-worker.mjs`: posts to the route every `VERIFICATION_WORKER_INTERVAL_MS` (15 s) and writes a heartbeat file on success. Healthcheck fails after 10 minutes without a successful call. |
| `POST /api/sumsub/webhook` | `web` service | Authenticates and stores a notification. Returns 401 on a bad signature, 503 if it could not store the event so the provider retries. |
| `verification_cases` | MongoDB | One document per business and environment. Holds the sanitized provider snapshot, Olio eligibility, policy version and revision. |
| `verification_events` | MongoDB | One document per authenticated notification, deduplicated by a digest of the signed bytes. |
| `identity_credentials` | MongoDB | One credential per business and environment, with publication consent. |
| `verification_audit` | MongoDB | Append-only record of state changes and operator actions. Never TTL-expired. |
| `verification_coordination` | MongoDB | Worker heartbeat and shared rate budgets. TTL-expired. |
| `GET /api/health/verification` | `web` service | Readiness reason, storage readiness, worker liveness, case counts, event backlog. |

## Watching it

```bash
docker compose logs -f verification-reconciliation
```

```bash
curl -s https://$DOMAIN/api/health/verification | jq
```

The health route returns 503 when verification is configured but degraded:
readiness failing, indexes missing, the worker dead while enabled, or any parked
event. It returns 200 with `"status":"disabled"` when `SUMSUB_MODE=off`, which
is the intended state before the commercial configuration is settled.

## Readiness reasons

| Reason | Fix |
|---|---|
| `disabled` | `SUMSUB_MODE=off`. Intended until sandbox levels are configured. |
| `credentials_missing` | Set `SUMSUB_APP_TOKEN` and `SUMSUB_SECRET_KEY`. |
| `webhook_secret_missing` | Set `SUMSUB_WEBHOOK_SECRET` from the Sumsub webhook manager. It is a different secret from the API key. |
| `levels_missing` | Set both `SUMSUB_INDIVIDUAL_LEVEL` and `SUMSUB_COMPANY_LEVEL`. |
| `storageReady: false` | Indexes missing. Run `pnpm migrate:up`. |

## Operator CLI

```bash
node web/scripts/verification-cases.mjs list --eligibility=manual_review
```

```bash
node web/scripts/verification-cases.mjs inspect <caseId>
```

| Command | What it does |
|---|---|
| `list [--eligibility=STATE\|open\|all] [--limit=N]` | Case counts and summaries. |
| `events [--state=STATE\|all] [--limit=N]` | Notification backlog; defaults to parked events. |
| `inspect <caseId>` | One case, its credential, and its audit history. The external id is truncated and reject labels are reduced to a count. |
| `reconcile <caseId> --reason=TEXT` | Brings the next authoritative re-check forward. Audited. |
| `requeue-event <eventId> --reason=TEXT` | Returns a parked notification to the queue. Audited. |
| `suspend <businessId> --reason=TEXT` | Suspends and unpublishes the current credential. Audited. |

There is **no approve command, by design.** Approval can only come from
reconciling real provider evidence through the policy. If a case looks wrong,
fix the evidence or the policy, then reconcile.

Set `VERIFICATION_OPERATOR=<your identifier>` so audit rows name a person.

## Parked work

| Parked reason | Meaning | Action |
|---|---|---|
| `unknown_case` | An authenticated notification referenced an external id Olio has no case for. Expected after a database restore or a level rebuild in the provider dashboard. | Confirm the applicant belongs to this deployment, then leave it parked. |
| `applicant_mismatch` | The notification's applicant does not match the applicant stored on that case. Treat as a provider-side identity change and investigate before requeueing. | Inspect the case; requeue only after the mapping is understood. |
| `provider_denied` | Credentials were rejected. | Check `SUMSUB_APP_TOKEN` / `SUMSUB_SECRET_KEY` and the token's permissions, then requeue. |
| `provider_malformed` | The provider returned something the adapter could not read. | Capture the case id, check the provider's changelog, requeue after a fix. |
| Exhausted attempts | Eight retries of a retryable failure. | Fix the cause, then requeue. |

A parked event never blocks scheduled reconciliation: the case is still
re-checked on its own schedule, so a missed notification cannot leave an
approval valid indefinitely.

## Incidents

**Provider outage.** Reads fail with retryable errors, events retry with backoff
up to 15 minutes, and case reconciliation keeps its existing schedule. No
credential changes. Existing badges stay published; they are only withdrawn once
evidence actually goes stale (seven days).

**Webhook secret rotated.** Rotate it in the Sumsub webhook manager and in
`SUMSUB_WEBHOOK_SECRET` together. Notifications signed with the old secret are
rejected; scheduled reconciliation still converges. Do not widen the accepted
algorithm set to work around a rotation.

**API key rotated.** Update `SUMSUB_APP_TOKEN` and `SUMSUB_SECRET_KEY`, restart
`web` and the sidecar, then requeue anything parked as `provider_denied`.

**A credential must be withdrawn now.** `verification-cases.mjs suspend
<businessId> --reason=...`. The badge unpublishes immediately and the public
page stops returning it.

**Suspected false approval.** Suspend first, then `reconcile` the case and read
the audit trail. Never edit `identity_credentials` by hand.

## Retention

- `verification_cases`, `identity_credentials` and `verification_audit` are
  operational and audit records. They are not TTL-expired; deleting them would
  destroy the evidence trail behind a credential.
- `verification_events` may be pruned once processed, subject to the retention
  period agreed with the provider and in the privacy notice. Keep parked events.
- `verification_coordination` is TTL-expired except the worker heartbeat.
- Documents, selfies and personal details live with the provider. Deletion
  requests are handled through the provider's own deletion flow; Olio's
  counterpart is suspending the credential and recording the action.

Agree the exact retention periods before live operation and record them here.

## Rollback

1. Set `SUMSUB_MODE=off` and `VERIFICATION_WORKER_ENABLED=false`. New onboarding
   and credential changes stop; existing badges stop being published because the
   public projection requires a matching environment.
2. Leave the webhook route deployed where possible: it keeps authenticating and
   storing notifications, so nothing is lost while the flag is off.
3. Do not run a destructive down migration as routine rollback. The migration's
   `down` is intentionally a no-op; dropping these indexes would drop the
   uniqueness guarantees that keep one applicant per case.
4. Do not delete case history, and never revoke a user's access to funds as part
   of a verification rollback. Verification gates badge issuance only.

## Before production

- Written acceptance of Olio's actual shielded USDC payment model.
- Contracted Indonesian KYC and KYB coverage, entity types, registry sources,
  manual fallback and foreign-owner handling.
- Agreed screening scope, ongoing monitoring, review responsibility, privacy
  notices, retention, data locations and audit access.
- Itemized KYB and owner-KYC pricing.
- A named operator with authority to review cases, listed in
  `VERIFICATION_OPERATOR_PRIVY_IDS`.
