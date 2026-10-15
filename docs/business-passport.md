# Track Record: invoices and settlement evidence

Track Record turns verified identity into verifiable payment history: a business
proves it is real and gets paid, without publishing its books. It was called the
business passport before, and code, collections and the statement `kind` keep
that name (`passport.*`, `passport_statements`, `olio.passport.statement`).
This page covers the first milestone: encrypted invoices, payment intents that
bind an invoice to an on-chain deposit, and a settlement ledger built only from
indexed pool events. Receipts that a third party can verify (M2) and private
threshold proofs (M3) build on this foundation.

## What a settlement is

A settlement is created from exactly one source: a `deposit` event that the pool
indexer has mirrored and published. A browser callback, a payment link flag, or
an operator command never creates one. Each settlement has a deterministic id,
`<network>:<poolId>:<leafIndex>`, so replaying the indexer or the reconcile
worker cannot duplicate it.

The amount of a settlement is the `payment_amount` from the `fee` event in the
same transaction. The contract emits both events from a single `deposit` call,
so the transaction hash joins them.

## How an invoice is bound to a payment

The signed fee quote is the binding point. When a payer opens an invoice link
and requests a quote, the server:

1. checks that the invoice is open, belongs to the recipient's bound account,
   and that the payer saw its current version;
2. draws a 32-byte `intentNonce` and sets
   `quoteId = sha256("olio.intent.v1" ‖ invoiceCommitment ‖ intentNonce)`;
3. stores a `payment_intents` row and a `quote_contexts` row, then signs the
   quote.

The pool contract consumes each `quote_id` once and emits it in the `fee` event.
Anyone holding the invoice commitment and nonce can recompute the quote id and
check it against the chain, without any contract or note-format change.

`invoiceCommitment` is
`sha256("olio.invoice.v1" ‖ businessId ‖ invoiceId ‖ version ‖ network ‖ poolId ‖ asset ‖ amountDue ‖ issuedAt ‖ dueAt ‖ contentCommitment)`
with each field length-prefixed and the top three bits cleared, so the value is a
valid BN254 field element. `contentCommitment` is
`sha256(canonicalJSON(content without salt) ‖ salt)` and is computed in the
browser. The implementation is `web/src/lib/invoiceCrypto.ts`.

## Invoice privacy

Customer names, line items and notes never reach Olio in plaintext.

- Each invoice has a random 32-byte key. The browser encrypts the content with
  XChaCha20-Poly1305 and wraps the key to the business's registered view key.
- A payment link carries the key after `#k=`. Browsers never send the URL
  fragment to a server, so Olio sees only ciphertext.
- The pay page decrypts the content and checks it against the stored
  `contentCommitment` before showing it.
- Olio stores the amount, due date, version history and commitments, because
  those are needed to bind payments and to produce evidence later.

Only someone holding the business view key (normally the account owner) can read
invoices in the dashboard. Other members see amounts and states only.

## Invoice lifecycle

| State | Meaning |
|---|---|
| `draft` | Saved but not payable. Can be revised or voided. |
| `issued` | Open for payment, nothing applied yet. |
| `partially_paid` | Payments applied, less than the amount due. |
| `paid` | Applied payments, net of refunds, cover the amount due. |
| `cancelled` | Closed by the business after issue. Payments already in flight still settle and are recorded. |
| `void` | A draft that was discarded. |

Invoice versions are insert-only. Revising inserts version `v+1`; there is no
update path. A revision is refused while a payment intent for the invoice is
open, and once any payment has been applied; such an invoice can only be
cancelled. The state is a projection of the allocations and is never set by a
client. `recomputeInvoice` rebuilds it from `settlement_allocations` and the
reconcile worker repairs stalled allocations.

## Allocation, partial payment, overpayment and refunds

MongoDB here runs without multi-document transactions, so allocation is made
safe with single-document guards:

- the allocation id is deterministic (`<settlementId>:<invoiceId>:<version>`),
  so a retry is idempotent;
- the settlement cap is a conditional `$inc` that only succeeds while
  `allocatedAmount + x ≤ amount`;
- a second conditional `$inc` on the invoice prevents over-allocation; if it
  fails, the settlement increment is compensated and the allocation is marked
  reversed.

A payment below the amount due leaves the invoice `partially_paid`. An
overpayment fills the invoice and leaves the remainder unallocated; it is not
applied to other invoices.

A refund is recorded against an indexed `withdraw` event. Its amount must not
exceed the unrefunded part of the settlement, and a withdrawal can be claimed as
a refund only once. A refund first consumes any unallocated overpayment, then
reduces the newest allocations, so the invoice moves back to `partially_paid`
when appropriate.

## Evidence levels

| Level | Meaning |
|---|---|
| `intent_bound` | The deposit used a quote derived from a specific invoice version. |
| `attributed` | The deposit used a quote Olio issued for the business, without an invoice. |
| `historical_claim` | The business opened the note (amount and salt) and it matches one of its recorded keys. |
| `unattributed` | No attribution context exists. Kept so a later claim can attach to it. |

Cross-chain payments show two separate facts: "payer sent" (the burn was
submitted on the source chain) and "settled" (the intake contract's deposit was
indexed in the pool). Only the second creates a settlement.

## Qualification flags (policy v1)

- `selfFunded`: the payer is the business's bound account, a member's Olio
  account, or a member's Privy signer.
- `counted`: settled, not self-funded, and not fully refunded.

Limitation: Olio cannot detect independent wallets that a business controls.
A business can still pay itself from an unrelated wallet. Later milestones
address this with customer attestations and independence claims.

## Key history

`business_keys` records each generation of note and view keys registered for the
business's username, with the ledger range it was active. A new generation is
recorded when the account is bound and after the relay submits a registry
`register` or `set_pubkey`, confirmed by reading the registry back.

The recovery escrow keeps retired generations (`priorEscrows`), each encrypted
under the same PIN. Changing the PIN re-wraps every generation, and the server
refuses a rotation that would drop one. When the registered keys do not match
the newest generation, unlocking looks through the retired generations instead
of failing.

## Data retention and erasure

Erasing an invoice removes `encryptedContent` and `wrappedKey` from every
version (crypto-shredding). The invoice number, amounts, due date, state,
commitments and allocations stay, so evidence that was already issued remains
valid. Settled payment intents are never deleted. Open intents expire seven days
after their quote expiry through a partial TTL index. `quote_contexts` has no
TTL; it drops the view key once a settlement exists and keeps only the
attribution fields.

## Operations

| Piece | Role |
|---|---|
| `POST /api/cron/settlements-reconcile` | Reconciles indexed deposits up to the published leaf, applies allocations, repairs stalled ones. `?leaf=N` reruns one leaf. |
| `settlements-reconcile` sidecar | `node web/scripts/settlements-worker.mjs`, every 30 s. |
| `GET /api/health/settlements` | Backlog, pending allocations, last run and degraded reasons. Never totals. |
| `POST /api/cron/evidence-epoch` | Registers the evidence signing key and evaluates the issuance gate. |
| `evidence-epoch` sidecar | `node web/scripts/evidence-worker.mjs`, every 5 minutes. |
| `GET /api/health/evidence` | Mode, gate reasons, last epoch, anchor account balance status. |
| `GET /.well-known/olio-evidence.json` | Published evidence keys with `validFrom` / `validTo`, so rotating a key never invalidates older manifests. |

The pool indexer now also stores each deposit's event id, mirrors `withdraw`
events, and maintains `pool_roots` (leaf count to root) with the same Poseidon
tree as the contract. At the chain tip it compares its root with
`current_root()`. A mismatch marks the index `degraded`.

The evidence issuance gate stays closed while the pool index is degraded, the
nullifier mirror is incomplete, the mirrored root is mismatched or unverified,
reconcile is behind the published deposits, or the signer and anchor accounts
are not configured. A business's evidence also requires a current identity
credential from an environment allowed for the network; a sandbox credential
never backs a mainnet track record. Suspension, decline, or an ownership change
closes this path immediately, because the gate reads the credential state live.

### Environment

| Variable | Purpose |
|---|---|
| `SETTLEMENTS_WORKER_ENABLED` | `true` to run reconciliation. |
| `EVIDENCE_MODE` | `off`, `testnet` or `mainnet`. Must match the network in production. |
| `EVIDENCE_SIGNER_SECRET` / `EVIDENCE_SIGNER_KEY_ID` | Ed25519 evidence signer and its published id. Must differ from `FEE_QUOTE_SIGNING_SECRET`; startup refuses otherwise. |
| `EVIDENCE_ANCHOR_SECRET` | Issuer account that anchors manifests with a `MEMO_HASH` transaction. |
| `EVIDENCE_EPOCH_INTERVAL_SECONDS`, `EVIDENCE_POLICY_VERSION`, `EVIDENCE_MANIFEST_TTL_DAYS` | Epoch cadence, policy version and manifest lifetime. |

### Deploying

1. Run the migration (`20261007090000-invoices-settlements.js`). It creates the
   indexes and copies existing CCTP quote contexts into `quote_contexts` before
   their TTL removes them.
2. Run `initialize-pool-storage.mjs` for the scoped `withdrawals` indexes.
3. Run the backfills, each a dry run first:

```bash
node web/scripts/backfill-pool-roots.mjs --env-file=PATH --expected-database=NAME
```

```bash
node web/scripts/backfill-deposit-event-ids.mjs --env-file=PATH --expected-database=NAME
```

```bash
node web/scripts/backfill-settlements.mjs --env-file=PATH --expected-database=NAME
```

   Add `--execute` once the dry-run output looks right. Deposits older than RPC
   retention keep `eventId: null`. `backfill-settlements` copies remaining
   attribution contexts, recovers contexts for completed CCTP sessions when
   `CCTP_SESSION_KEY` is present, and resets the reconcile watermark so the
   worker re-reads every leaf and upgrades unattributed ones.
4. Enable `SETTLEMENTS_WORKER_ENABLED`.

`reset-pool-storage.mjs` refuses to reset a pool that has settlements or evidence
epochs, so evidence is never silently orphaned.

### Operator CLI

```bash
pnpm --dir web settlements:cases gaps
```

`settlements-cases.mjs` lists unattributed deposits, inspects a leaf, reports
mirror gaps and reconcile backlog, reruns reconciliation for one leaf (audited),
and shows evidence epochs. It has no command that marks anything paid.

## Payment statements

The public badge at `/business/<publicId>` shows identity only: name, type,
"Identity Verified", last checked and valid until. Payment history appears only
in a payment statement, a PDF the owner downloads from Settings → Track Record and
sends to the people they choose.

### What the owner chooses

| Option | Choices | Default |
|---|---|---|
| Detail | Monthly summary · Full payment list | Monthly summary |
| Period | Last 3 / 6 / 12 months, All time | 12 months |
| Payer addresses (full list only) | Masked `GABC…WXYZ` · Full · Hidden | Masked |

Periods start on the first day of a UTC month and end at issuance, so every
monthly bucket except the current one covers a whole month. A full list is
refused above 1,000 payments; the owner picks a shorter period or the summary.

### What counts toward the totals

Statements read the settlement ledger for the business on the current network
and pool. Only settlements with `qualification.counted` are included, and each
is counted net of `refundedAmount`. Self-funded and fully refunded settlements
are left out, and the statement says how many were left out. "Distinct payers"
counts distinct payer addresses among the counted settlements.

### Issuance

`passport.issueStatement` requires a manager of the business and an active
business with a current identity credential that backs this network (the same
check as other evidence). Statements are always on: they need no evidence
signer, anchor or `EVIDENCE_MODE`, so none of the evidence environment applies
to them. It is rate-limited per business.

A statement presents the payment history as complete, so issuance also needs
the settlement ledger to mirror every published pool deposit (`recordsGate()`
in `evidence.gate.ts`, the pool and reconcile half of the evidence gate):

| Records state | Response |
|---|---|
| Pool index unpublished, roots unverified, nullifiers incomplete, or reconcile behind | `syncing`: "Payments after <time> UTC are still syncing. Try again in a few minutes." |
| Pool index degraded, roots mismatch, or reconcile degraded | `records_on_hold`: statements wait until the records are repaired |

`<time>` is when the pool index was last published. Issued statements carry it
as `recordsAsOf`, and the PDF and verify page print it.

The statement is a JSON document (`kind: "olio.passport.statement"`,
`version: 1`) with the identity fields of the public badge, the period, detail,
payer mask, totals, monthly buckets, optional rows, the qualification policy
version, `recordsAsOf`, `issuedAt` and `expiresAt` (90 days). The server takes
`digest = sha256(canonicalJSON(statement))` (sorted keys, no whitespace, as in
`invoiceCrypto.canonicalJson`) and stores it with the statement record. The
statement is not signed: authenticity comes from the verify page, which reads
Olio's record. A signature can be added later if partners need to check
statements offline. The browser renders the PDF (`web/src/lib/passportPdf.ts`) from the
returned statement.

### Verify flow

Every page of the PDF carries the statement id, a short digest and the verify
URL; page 1 carries a QR code, and the last section prints the full digest.
`/verify/<statementId>` (backed by the public, rate-limited
`passport.verifyStatement`) shows who it was issued for, the period, the totals,
the digest, when its payment records were complete, whether the business's identity is current today, and
one of three states: valid, revoked or expired. A reader compares the digest on
the page with the one in the PDF. The totals on the page come from Olio's record,
not from the PDF, so an edited PDF does not match.

### Privacy

`passport_statements` stores the id, business, digest, records-as-of time,
period, detail, payer mask, totals, issue and expiry dates, and revocation.
It never stores payment rows or payer addresses; those exist only in the PDF.
Anyone holding a statement link learns the business name and totals, which is
what the owner chose to share by sending the file.

### Revocation

The owner can revoke a statement from Settings. The verify page then reports it
as revoked from that moment. Copies already sent still exist, but anyone who
checks sees they are no longer valid. Revocation is recorded in the
verification audit log, as is issuance.

## Trust model and limitations

- Settlement facts (amount, time, transaction) come from public chain data that
  anyone can replay. Attribution (which business, which invoice) relies on the
  quote context Olio recorded when it signed the quote.
- Pool roots older than the contract's 30-root window are only available from
  Olio's mirror or from replaying deposit events. M2 adds a signed root
  manifest so verifiers do not have to trust the mirror.
- History older than RPC retention cannot be backfilled from RPC. Gaps are
  reported and never filled with guesses.
- Payments received before key history was recorded can be claimed only with a
  key generation Olio has on record.
- This milestone records evidence. It does not yet sign manifests, build
  evidence trees or produce proofs; those arrive in M2 and M3.
