# Cashing Out

Withdraw private payments to a Stellar wallet.

## To a Stellar wallet

Send your balance to any Stellar address. Olio quietly handles a detail most apps
trip over: if the destination isn't set up to hold USDC yet, Olio still delivers
the funds (as a "claimable balance" the wallet can pick up) instead of failing.
So you can pay out to almost any address without the recipient doing setup first.

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
