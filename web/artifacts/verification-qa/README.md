# Verification QA — Playwright run

Date: 2026-09-22
Scope: Sumsub verification onboarding, identity passport, public identity page,
route protection, bento layout and accessibility.

## How it was run

```bash
cd web && E2E_MONGODB_URI=mongodb://127.0.0.1:27017/olio_e2e pnpm run test:e2e
```

```bash
cd web && pnpm run test:e2e:report
```

`E2E_SKIP_BUILD=1` reuses an existing production build instead of rebuilding.

| Setting | Value |
|---|---|
| App under test | `next build` + `next start` on `127.0.0.1:3111` (see the note on dev mode below) |
| Database | `mongodb://127.0.0.1:27017/olio_e2e`, isolated from the local `olio` database |
| Fixtures | Seeded in `e2e/globalSetup.ts`, removed in `e2e/globalTeardown.ts`. Synthetic businesses only (`biz_e2e_*`). |
| Provider | `SUMSUB_MODE=live` with placeholder credentials. No request reaches Sumsub: the SDK and API origins are intercepted. |
| Projects | `desktop-chromium` (Desktop Chrome, 1280×720) and `mobile-chromium` (Pixel 7, 412×915) |
| Playwright | 1.63.0, Chromium headless shell 153 |

## Result

**94 passed, 0 failed** (47 per project) in 4.4 minutes.

| Spec | Covers |
|---|---|
| `verification.spec.ts` | Individual and company onboarding, profile creation, account linking, session open/resume/close, pending / needs-information / manual-review / declined / approved states, provider outage, rate limit, expired SDK token, repeated submits, and that a client-side submission never produces an approval. |
| `passport.spec.ts` | Private preview, publish and hide with explicit consent, refusal to publish an unapproved or suspended credential, expired state, server refusal, the public page for published / unpublished / suspended / stale / sandbox / unknown ids, webhook and cron authentication, and the health endpoint's field allowlist. |
| `verification-layout.spec.ts` | Bento layout at both sizes, no horizontal overflow, shared tile radius and typography, gutters, restrained iconography, labelled regions, named icon-only controls, keyboard activation, text-not-colour status, console and network errors, and the existing withdraw route. |

Screenshots of both screens at both sizes are attached to the HTML report
(`playwright-report/`, regenerate with the command above). They were inspected:
the screens use the existing bento tiles, the linen/glass alternation, the
36 px tile radius and the dashboard heading font, with no overflow or clipped
text at either size.

## Defects found and fixed during QA

1. **Infinite render loop in the verification session (fixed).** The SDK-token
   callback was rebuilt on every render, so the token effect re-fired
   continuously: React error #185 and repeated `verification.sdkToken` calls.
   Fixed by holding the mutation and refetch in refs in
   `src/features/verification/useVerification.ts`; covered by
   `test/useVerification.test.tsx` and by the "keeps repeated submit clicks to a
   single session" browser test, which asserts at most two token requests.
2. **Low-contrast footer text on glass tiles (fixed).** Raised from 60 % to
   75 % opacity on the passport claim and the verification policy footer after
   inspecting the mobile screenshots.

## Pre-existing issues found, not fixed here

1. **The Next middleware never runs.** `web/middleware.ts` sits one level above
   `src/app`, so Next does not load it: after a build,
   `.next/server/middleware-manifest.json` is empty and `/dashboard`, `/links`,
   `/withdraw`, `/verification` and `/passport` all return 200 without a
   session cookie. Client-side gating and authenticated tRPC procedures still
   protect the data, but the cookie redirects are inert. Out of scope for this
   change; a follow-up task was raised. The route-protection tests therefore
   assert that no verification content renders for an unauthenticated visitor,
   rather than asserting a redirect.
2. **`FIAT_SESSION_KEY` in the local `.env.local` is a placeholder**, which
   fails `next build` with a Zod error on `/.well-known/stellar.toml`. The e2e
   web server overrides it with a dummy 64-hex value.
3. **`next dev` cannot hydrate in this environment**: the client chunk
   `/_next/static/chunks/app/layout.js` 404s, leaving every page server-rendered
   only. This is why the e2e web server runs a production build. Unrelated to
   the verification work.
4. **Two Vitest failures on this machine** (`test/poolStorageScript.test.ts`)
   come from Node 20.11.1, whose `--env-file` cannot read any file; the repo
   targets Node 22+. Two more (`test/WalletProvider.test.tsx`) are load-related
   timeouts that pass when the file runs on its own.

## Not covered

- **A real Sumsub sandbox journey.** No sandbox credentials were available, so
  every provider interaction in these tests is mocked at the HTTP boundary.
  The real SDK flow, real applicant creation, real webhook signatures from
  Sumsub, company beneficiary collection and provider-side reset are
  **untested against the live sandbox** and must be exercised before any pilot.
- **Authenticated dashboard routes end to end.** Privy cannot initialise for
  `127.0.0.1:3111` (the app id's allowed origins reject it), so the
  authenticated screens are driven through `/e2e-harness`, a page that exists
  only when `E2E_HARNESS=1` and renders the same components inside the same
  shell. It performs no authentication of its own and grants no access to real
  data: every private procedure still requires a valid Privy token, which these
  tests never hold.
- **Operator CLI and worker sidecar** are covered by Vitest and by manual
  inspection, not by browser tests.

## Data handling

All fixtures are synthetic. No authentication state, SDK token or personal data
is written to this directory; the report, traces and screenshots are ignored by
git (see the repository `.gitignore`), and only this summary is committed.
