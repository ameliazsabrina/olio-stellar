# Security & Recovery

Straight talk on how Olio keeps your money safe, what you're responsible for, and
what's still being hardened.

## You hold the keys

Olio is **self-custodial**. That means:

* The app and its servers **can't** spend or move your money.
* We **can't** see your private balance — it's decrypted only in your browser.

The pool contract does have limited governance and emergency controls. They are
protected by a **2-of-3 multisig**, and sensitive changes must wait **48 hours**
on-chain before they can take effect. The multisig can pause the pool
immediately during an incident, which temporarily prevents deposits, transfers,
but not withdrawals. This preserves an escape hatch for holders of valid notes.
See [Multisig & Timelocked Governance](multisig-governance.md)
for the exact powers and limits.

The flip side: **your keys are your responsibility.** Which is why we built a
recovery path.

## Your passkey + PIN

* **Passkey** — your device's fingerprint/face unlock signs your transactions. No
  seed phrase to lose or get phished.
* **6-digit PIN** — your backup and recovery key. It lets you get back into your
  account and unlock spending.

{% hint style="danger" %}
**We will never ask for your PIN, passkey, or any recovery info** — not by email,
DM, chat, or "support." Anyone who does is trying to scam you. Only ever enter
your PIN in the Olio app itself.
{% endhint %}

## What we can and can't protect

**We protect:**

* The privacy link between who paid you and what you withdraw.
* Custody — funds live in an on-chain pool, not on our servers.
* Governance — no single operator key can pause the pool or propose a sensitive
  contract change.

**We can't protect against:**

* Losing your PIN *and* your device with no recovery set up.
* You approving a payment you didn't mean to.
* The stuff privacy can't hide by design (see below).
* A temporary pool pause authorized by two governance signers during an
  emergency.

## What's visible even with Olio

Being honest here — Olio hides the *link* between payments, not everything:

* When you cash out, the **amount and destination** are public on-chain.
* If you withdraw right after getting paid, **timing** can hint at a connection.
* To issue a recipient-bound fee quote, Olio's server sees the username, payer,
  principal, commitment, and one-time note salt. It does not receive the
  recipient's spending secret, and direct-payment salts are not persisted, but
  this is a deliberate reduction from a browser-only proof flow.
* For asynchronous CCTP recovery, the server temporarily retains the quote ID,
  stable recipient owner, commitment, and issuance-time public note/view keys.
  It does not retain the username or salt. The record expires automatically
  after the recovery window and prevents a later key rotation from stranding an
  already-burned payment.
* The public fee event includes the rate and amount. It does not include the
  username, payment-link ID, note/view key, or salt.

The pool accepts only 200 or 500 bps, verifies a dedicated Ed25519 quote signer,
checks expiry and exact arithmetic, and consumes each random quote ID once.
Signer rotation is timelocked. Private transfers are disabled in this release
because the current transfer circuit cannot enforce the hidden recipient tier.

For the cleanest privacy, let funds rest and avoid withdrawing exact
payment-sized amounts immediately. Full details in
[Practical Privacy](practical-privacy.md).

## Testnet status — please read

Olio is currently on **testnet** with play money. It is **not yet independently
audited**. Before real funds and mainnet launch, we still need:

* A proper security ceremony for the privacy math.
* Independent audits of the contracts, privacy circuits, and app.
* Operational hardening for cash-out, cross-chain, and recovery.

Treat today's Olio as a preview of the experience, not a vault for real money.

## Need help?

Reach out only through Olio's **official** channels (linked in the app). Scammers
love to impersonate support. When in doubt, slow down — no real support agent
will ever rush you into sharing a PIN or recovery phrase.
