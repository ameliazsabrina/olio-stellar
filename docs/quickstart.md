# Quickstart

Set up Olio, send your first invoice and get paid. You don't need a seed phrase
or a token for network fees.

## 1. Create your account

Open Olio and sign in with a **passkey**, the fingerprint or face unlock your
phone or laptop already uses. There is no seed phrase to write down.

## 2. Set your PIN

Choose a 6-digit PIN. It is your recovery key: it restores your account on a new
device and unlocks spending.

{% hint style="warning" %}
Olio will **never** ask for your PIN by email, chat or phone. Store it where the
business can recover it. If the PIN and every signed-in device are lost, Olio
cannot reset access for you.
{% endhint %}

## 3. Claim your username

Pick the name customers will see, such as `@studio-nusantara`. Your general
payment link becomes:

```text
olio/pay/studio-nusantara
```

## 4. Verify your business

Submit verification as a **company**, or as an **individual** if you work as a
sole proprietor. Olio uses Sumsub for the identity checks. You need to submit
verification before you can receive payments.

When your verification is approved, Olio shows a verified badge on your
**Passport** page. The badge is private until you choose to publish it.

## 5. Issue an invoice

Go to **Invoices** → **New invoice**. Add line items and a due date, then choose
**Issue invoice**, or save it as a draft.

* Customer names, line items and notes are encrypted in your browser before
  they reach Olio. Olio can read the amount, due date and status, which it
  needs to match payments to the invoice.
* Choose **Copy payment link** and send the link to your customer. The link
  includes the key that lets them read the invoice, so share it only with them.
* You can revise an issued invoice until a payment is made against it. After
  that you can only cancel it.

For quick payments without an invoice, use **Links**. A simple link lets the
customer choose the amount, and a managed link has a fixed amount and label.

## 6. Get paid

Your customer opens the link and pays in USDC from a Stellar wallet or from
another chain such as Ethereum, Base or Solana. They don't need an Olio account.
Olio's 2% service fee is added on top of the invoice, so you receive the
full amount.

The invoice updates when the payment settles: **Partially paid** if the customer
paid part of it, **Paid** when it is covered. The payment itself becomes part of
your **private balance**, which only you can read.

## 7. Prove a payment when asked

To show a bank, accountant or tax office that a payment happened, open
**History**, pick the payment and create a **payment receipt**. It is a PDF
disclosure that proves that one payment and nothing else. You can also publish your verified badge
from **Passport** and share its public link, so customers can check that Olio
verified your business.

## 8. Cash out

Send your balance to a Stellar wallet. See [Cashing Out](cashing-out.md).

---

That's the loop: **verify → invoice → get paid → prove → cash out.**

To see what happens behind the scenes, read [How Olio Works](how-it-works.md).
