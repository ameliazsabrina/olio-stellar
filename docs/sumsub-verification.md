# Identity verification (Sumsub)

Olio's Release 1 verification integration gives a business profile one
verification case with Sumsub, evaluates the provider's evidence against Olio's
own policy, and — only if that policy is satisfied — issues an *Identity
Verified* credential the owner may choose to publish.

Olio owns the decision. Sumsub supplies evidence.

## What the badge claims

| Claimed | Not claimed |
|---|---|
| Identity documents and the configured checks passed Olio's policy at the recorded time | Revenue, turnover or business volume |
| The claim was issued by Olio under a stated policy version | Customer relationships or independence |
| The evidence was current when last re-checked | Creditworthiness |
| The subject is an individual or a company | Compliance with any particular jurisdiction's rules |

The public page repeats this scope in plain words. Do not extend the wording
without re-reading [the passport service](../web/src/server/modules/passport/passport.service.ts).

## Moving parts

| Piece | Where | Role |
|---|---|---|
| `businesses.*` | `web/src/server/modules/businesses/` | Stable business identity, membership roles, and the authoritative account/username binding. |
| `verification.*` | `web/src/server/modules/verification/` | Provider adapter, webhook intake, durable worker, versioned policy, private status API. |
| `passport.*` | `web/src/server/modules/passport/` | Credential preview, publication consent, allowlisted public projection. |
| `POST /api/sumsub/webhook` | `web/src/app/api/sumsub/webhook/route.ts` | Authenticates the provider notification and persists a durable job. It never decides anything. |
| `POST /api/cron/verification-reconciliation` | `web/src/app/api/cron/...` | `CRON_SECRET`-protected worker invocation. |
| `GET /api/health/verification` | `web/src/app/api/health/verification/route.ts` | Readiness, worker heartbeat, case counts, event backlog. No applicant data. |
| `verification-worker.mjs` / `verification-cases.mjs` | `web/scripts/` | Sidecar driver and the restricted operator CLI. |

## Configuration

All values are server-only. None of them belong in `NEXT_PUBLIC_*`.

| Variable | Meaning |
|---|---|
| `SUMSUB_MODE` | `off` (default), `sandbox` or `live`. `off` disables every provider call and the worker. |
| `SUMSUB_APP_TOKEN` / `SUMSUB_SECRET_KEY` | API credentials. The secret key signs requests; it is never the webhook secret. |
| `SUMSUB_WEBHOOK_SECRET` | Separate secret configured in the Sumsub webhook manager. |
| `SUMSUB_WEBHOOK_ALGORITHM` | `HMAC_SHA256_HEX` (default) or `HMAC_SHA512_HEX`. `HMAC_SHA1_HEX` is deprecated and rejected. |
| `SUMSUB_INDIVIDUAL_LEVEL` / `SUMSUB_COMPANY_LEVEL` | Configured level names. The server picks the level from the profile type; clients cannot choose. |
| `SUMSUB_EXPECTED_CLIENT_ID` | Optional. When set, notifications carrying a different `clientId` are ignored. |
| `SUMSUB_TIMEOUT_MS` | Per-request timeout for provider calls (default 15000). |
| `VERIFICATION_POLICY_VERSION` | Stamped onto every case and credential. Bump it when the policy changes. |
| `VERIFICATION_WORKER_ENABLED` | `true` to let the cron route drain work. |
| `VERIFICATION_OPERATOR_PRIVY_IDS` | Comma-separated Privy user ids allowed to read the operator case list. |

At production runtime with `SUMSUB_MODE=live`, missing credentials, webhook
secret or level names fail startup rather than degrading silently.

The provider origin is fixed to `https://api.sumsub.com`. Sandbox and live are
separated by credentials and by the stored `environment` on every case,
credential and event — not by a hostname.

## Request signing

Requests carry `X-App-Token`, `X-App-Access-Ts` and `X-App-Access-Sig`. The
signature is `HMAC-SHA256(secret, ts + METHOD + path-with-query + body)`, hex
lowercase, over the exact bytes transmitted; GET requests sign no body. See
[`sumsub.client.ts`](../web/src/server/modules/verification/sumsub.client.ts).

Applicant creation is never blindly retried. After an ambiguous failure the
client reconciles by `externalUserId`, and reports `ambiguous` if it still
cannot tell whether an applicant exists.

## Identity mapping

`externalUserId` is a random opaque value, namespaced by environment
(`olio-sandbox-<32 hex>`). It is never a wallet address, username, e-mail, NIK
or tax id, and it never encodes the business id. Sandbox and live applicants can
never satisfy the same credential.

Documents, selfies and personal details stay in Sumsub's hosted experience.
Olio stores only the sanitized snapshot it needs to apply policy: review status,
answer, reject type, reject labels, evidence completeness, and the review state
of each associated person.

## Webhook and reconciliation

1. The route reads raw bytes with a 64 KiB limit on the Node runtime.
2. `x-payload-digest` is verified against the configured algorithm with a
   constant-time comparison. Unsigned, wrongly signed, unknown-algorithm and
   SHA-1 notifications are rejected with 401 and never stored.
3. Only then is the body parsed. `testMode` notifications, notifications for a
   different `clientId`, and notifications whose `sandboxMode` disagrees with the
   deployment are ignored.
4. A normalized event is inserted under a deterministic id derived from the
   signed bytes plus the environment. A duplicate insert is reported as a
   duplicate; a storage failure returns 503 so the provider retries.
5. The worker claims the event, maps it to a case by external id, refuses a
   mismatched applicant, and then **re-reads the provider's current state**.
   The notification is a wake-up, never a source of truth.
6. Updates are applied with a revision check under a lease, so a delayed writer
   cannot overwrite newer state.
7. Open cases re-reconcile hourly, approved cases daily, declined cases weekly,
   independently of whether any notification arrives.

There is deliberately no timestamp-rejection window: authenticity plus
deduplication plus authoritative re-reads already prevent a replay from granting
anything, and a window would defeat legitimate provider retries.

## Policy

[`verification.policy.ts`](../web/src/server/modules/verification/verification.policy.ts)
maps provider evidence to Olio eligibility:

| Provider evidence | Olio eligibility |
|---|---|
| `init` | `not_started` |
| `pending`, `prechecked`, `queued`, `awaitingService` | `pending` |
| `awaitingUser` | `needs_information` |
| `onHold` | `manual_review` |
| `completed` + `GREEN` + complete evidence (+ all associated persons green, for a company) | `approved` |
| `completed` + `GREEN` + missing evidence or missing/unresolved owners | `manual_review` or `pending` |
| `completed` + `RED` + `RETRY` | `needs_information` |
| `completed` + `RED` + `FINAL` | `declined` |
| `RED` with a screening label (PEP, sanctions, adverse media, …) | `manual_review`, never an automatic rejection |
| Applicant type, level or sandbox flag disagrees with the case | `manual_review` |

A GREEN answer alone is never sufficient. A company with no associated persons
on record is never published as complete.

A provider reset (a case that had progressed returning to `init`) moves the case
to `needs_information`, increments the review cycle, and suspends any credential.

## Credential lifecycle

A credential is issued only from an approved case, is valid for one year, and is
treated as stale if the evidence has not been re-checked within seven days.
Suspension is automatic when eligibility regresses, when the linked Olio account
changes, or when an operator suspends it. Suspension also unpublishes the badge.

Publication is separate from issuance and always requires an explicit action by
an owner or admin. The public projection returns nothing for an unpublished,
suspended, expired or stale credential, for a non-active business, or for a
credential from another environment. A sandbox credential is never published
from a production deployment.

## Privacy boundaries

- Note secrets, balances and payment history are never sent to the provider.
- Reject labels, screening reasons and moderation comments stay server-side;
  users see a plain sentence, operators see the reason codes.
- The public page exposes only the opaque public id, display name, subject type,
  issuer, scope, policy version, and the two dates.
- Provider payloads, SDK tokens and API secrets are never logged.

## Operations

Day-to-day running, incidents, retention and rollback are in
[verification operations](verification-operations.md).
