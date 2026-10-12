# Interface & Features

A tour of the dashboard, section by section.

## Dashboard

Your overview: your private balance, your payment link, recent activity, and
shortcuts to create a link, withdraw or prove a payment. The balance is
decrypted in your browser. Olio's servers can't read it.

## Invoices

Bill a customer for a specific amount and keep a record of what was paid.

* **Create.** Add line items and a due date. Save as a draft or issue it
  straight away.
* **Share.** Copy the invoice's payment link and send it to your customer. The
  link carries the key that decrypts the invoice, so only people you send it to
  can read it.
* **Private content.** Customer names, line items and notes are encrypted in
  your browser. Olio sees the amount, due date and status, which it needs to
  match payments to the invoice.
* **Track.** Each invoice is **Draft**, **Issued**, **Partially paid**,
  **Paid**, **Cancelled** or **Void**. An invoice only becomes Partially paid
  or Paid when a payment settles on chain; nobody can mark it paid by hand.
  Partial payments, overpayments and refunds are recorded against the
  invoice.
* **Revise or cancel.** You can revise an issued invoice until a payment is made
  against it. After that you can only cancel it. Payments already on their way
  still settle and are recorded.

## Payment links

For payments that don't need an invoice. Every link has a QR code.

* **Simple link** (`olio/pay/username`): the customer chooses the amount. Good
  as a general "pay us" link.
* **Managed link** (`olio/pay/username/your-slug`): a fixed amount and label,
  such as "Monthly retainer — 1,500 USDC". Good for recurring or standard
  services.

## Fees at checkout

Before the customer approves, checkout shows the payment amount, your 2% or 5%
Olio service fee, and their total. The fee is added on top, so you receive the
full amount.

## Withdraw

Choose a private payment and send it to any Stellar wallet, or withdraw all of
them at once. Each payment is cashed out whole. See
[Cashing Out](cashing-out.md).

## History

A private record of payments received and payments cashed out, readable only by
you. From here you can create a **payment receipt**: a PDF disclosure that
proves one payment to a bank, accountant or tax office without revealing any
other. See [Traceability, on your terms](practical-privacy.md#traceability-on-your-terms).

## Verification

Verify your company, or yourself as a sole proprietor, through Sumsub. You need
to submit verification before you can receive payments.

## Passport

When your verification is approved, you get an **Identity Verified** badge. It
stays private until you publish it. Once published, you can share its public
link so customers can confirm Olio verified your business.

## Settings

Your account handle, your recovery PIN (set it up or change it), verification
status, and sign-out.

{% hint style="info" %}
**Receiving costs you nothing up front.** You don't need to hold USDC or any
network token to receive a payment. Olio covers the network fees.
{% endhint %}
