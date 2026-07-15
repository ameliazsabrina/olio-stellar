# Cashing Out

Your money is yours — take it out whenever, however you like. Olio gives you a few
ways to do it.

## To a Stellar wallet

Send your balance to any Stellar address. Olio quietly handles a detail most apps
trip over: if the destination isn't set up to hold USDC yet, Olio still delivers
the funds (as a "claimable balance" the wallet can pick up) instead of failing.
So you can pay out to almost any address without the recipient doing setup first.

## To your bank (SEP-24)

Want actual dollars in your bank account? Olio connects to a regulated
**anchor** — a licensed service that swaps crypto for fiat and handles the bank
transfer.

Here's how it stays private:

1. Olio creates a **fresh, one-time account** just for this cash-out.
2. Your private balance moves to that account.
3. That account opens a session with the anchor.
4. **You enter your bank details directly with the anchor** — Olio never sees
   them.

Because a brand-new throwaway account sits in the middle, your main identity
stays separated from the bank interaction.

{% hint style="info" %}
On testnet, cash-out uses a practice anchor and play money. Real bank cash-out
comes with launch, along with the compliance steps that go with moving real
funds.
{% endhint %}

## Prove a payment (without cashing out)

Sometimes you don't want to move money — you just need to *prove* a payment
happened, for taxes, accounting, or your bank. Olio lets you export a disclosure
for a single payment, so a third party can verify it without seeing anything else.
See [Practical Privacy](practical-privacy.md#traceability-on-your-terms).

## A privacy reminder

When money leaves the private pool, the **amount and destination are visible** on
the blockchain — what's hidden is the link back to who paid you. For the cleanest
privacy, avoid withdrawing the exact amount of a payment immediately after
receiving it. See [Practical Privacy](practical-privacy.md).
