# Security & Recovery

Straight talk on how Olio keeps your money safe, what you're responsible for, and
what's still being hardened.

## You hold the keys

Olio is **self-custodial**. That means:

* We **can't** spend, freeze, or move your money.
* We **can't** see your private balance — it's decrypted only in your browser.
* We **don't** hold your bank details — those go straight to the anchor at
  cash-out.

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
* Your identity at cash-out — a throwaway account sits between you and the anchor.

**We can't protect against:**

* Losing your PIN *and* your device with no recovery set up.
* You approving a payment you didn't mean to.
* The stuff privacy can't hide by design (see below).

## What's visible even with Olio

Being honest here — Olio hides the *link* between payments, not everything:

* When you cash out, the **amount and destination** are public on-chain.
* If you withdraw right after getting paid, **timing** can hint at a connection.

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
