# Verification onboarding and inbox

The dashboard layout mounts one verification controller after wallet setup, recovery PIN and username creation finish. `/verification` redirects to `/dashboard?verification=1`; Settings, Passport and navigation open the same controller in place. A provider SDK event only starts confirmation. Dashboard access depends on the authenticated `verification.onboarding` response.

## Submission and enforcement

`verification_cases.firstSubmittedAt` records the first authoritative submission evidence within the case's environment. Provider snapshots must show submission/review and match the environment, applicant type and level. Accepted, matching applicant-submission/review webhooks also provide evidence even if a later snapshot has already reset. Resets, declines and requests for information never clear this timestamp. Sandbox cases cannot satisfy live enforcement.

The shared guard resolves the current authenticated wallet and the business bound to that account. Payment-link mutations require authentication, submission, current username ownership and the existing management token. Relay requests are allowlisted by contract and operation; registration and account recovery remain accessible before submission. Account payments require submission. Anonymous relay access only supports direct deposits with valid server-signed fee quotes bound to the network, pool, depositor, commitment and amount.

New fee quotes and new CCTP sessions require recipient submission. Customers do not need Olio accounts. Existing CCTP sessions and signed legacy-payment recovery remain available; no guard is added to settlement. A consistent precondition error with a safe user-facing message reopens the controller in dashboard clients. This enforces Olio's backend boundaries; direct Stellar transactions require separate contract restrictions.

## Durable notification delivery

Each case transition appends an embedded outbox entry in the same atomic revision-checked update as the case status and submission timestamp. The existing verification worker upserts a notification under its deterministic case/revision/kind ID before acknowledging the outbox entry. A crash between insertion and acknowledgment is safe to retry.

Inbox queries and read mutations recheck current owner/admin membership. Read state is shared across devices for each authenticated user. The inbox sorts by timestamp and ID, uses a stable cursor, includes unread counts, and refreshes every 15 seconds while visible and on focus. Normal polling reads stored status, not the provider.

## Rollout

1. Back up the database and apply `20261004090000-verification-onboarding.js` before serving the new dashboard or payment enforcement. Resolve duplicate bound-account profiles if the unique index reports conflicts; do not automatically delete profiles.
2. Deploy the compatible verification worker and drain notification outboxes. Migration preserves existing submission timestamps, backfills only from provider snapshots or accepted matching event history, and seeds one current-status notification per case.
3. Check verification storage/worker health, then enable the new web release. Keep Sumsub environment configuration consistent between web and worker.
4. Exercise new and returning accounts, both profile types, pending review, information requests, unavailable services, guest payments and existing-payment recovery before routing production traffic.

Rollback preserves submission metadata and notifications. The migration's `down` only removes the new indexes. Deploying this source change does not itself apply any migration to a remote database.

## Validation

Run `pnpm --dir web test` and `pnpm --dir web exec tsc --noEmit`. For MongoDB integration coverage, set `OLIO_TEST_MONGODB_URI` to a disposable local server and run the verification-onboarding, verification-storage and CCTP-session integration suites. Each suite uses a separate temporary database.

`pnpm --dir web test:verification-ui` runs the actual modal and inbox components in desktop/mobile Chromium with a deterministic provider iframe and backend fixture. It checks keyboard focus, backdrop/Escape prevention, reduced motion, horizontal overflow, server confirmation and read controls. Screenshots are saved under `web/artifacts/verification-onboarding`. This fixture does not replace a live Sumsub verification check.
