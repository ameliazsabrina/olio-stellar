# Business passport: invoices and settlement evidence

The business passport turns verified identity into verifiable payment history.
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
never backs a mainnet passport. Suspension, decline, or an ownership change
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
