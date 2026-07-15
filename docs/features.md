# Interface & Features

A quick tour of what you'll actually use day to day.

## Dashboard

Your home base. See your **private balance**, your personal payment link, and
your most recent activity at a glance. Only you can see this — it's decrypted
locally in your browser, not stored on a server for anyone to peek at.

## Payment Links

Share a link or QR code and get paid. Two flavors:

* **Simple link** (`olio/pay/username`) — the payer chooses the amount. Great as
  your general "pay me" link.
* **Managed link** (`olio/pay/username/your-slug`) — you set a fixed amount and a
  label, like "Consulting call — $150." Perfect for invoices and products.

Every link comes with a QR code for in-person or mobile payments.

## History

A private log of the payments you've received, readable only by you. Use it to
keep track of who paid, when, and how much — and to pull up a specific payment if
you ever need to prove it (see [disclosure](practical-privacy.md#traceability-on-your-terms)).

## Settings

Manage your account: your username keys, PIN, and account recovery. This is also
where re-keying lives if you ever need to rotate your keys.

{% hint style="info" %}
**Receiving needs nothing up front.** You don't need to hold any USDC or do any
setup to *receive* a payment — just your Olio account. You only interact with the
chain when you decide to cash out.
{% endhint %}
