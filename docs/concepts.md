# Concepts

A few core ideas that make Olio tick, explained plainly.

## Private notes (the shielded pool)

Instead of paying money *to your address*, Olio payments go into a shared
**shielded pool** — think of it as a big communal vault. Your payment becomes a
**private note** inside that vault: a sealed record that says "this much money
belongs to whoever holds the right key."

* The vault publicly shows only that *a note was added* — never who it's for or
  how much (until it's withdrawn).
* You discover your notes by scanning the vault and unlocking the ones meant for
  you.
* When you spend, you prove you own a valid note *without pointing to which one*.

This is what makes deposits and withdrawals **unlinkable** — the vault mixes
everyone's notes together, and the math keeps yours private.

## Unlinkability

The single most important idea in Olio: **an observer can't connect the money
coming in to the money going out.** They can see deposits happen and withdrawals
happen, but not that a particular deposit funded a particular withdrawal, or that
either one is yours.

## Self-custody & passkeys

Olio is **self-custodial** — you hold the keys, not us. We can't spend your
money, freeze it, or lose it for you. As the saying goes: *not your keys, not
your coins.*

Instead of a seed phrase, your account is protected by a **passkey** (your
device's fingerprint/face unlock) plus a **6-digit PIN** for backup and recovery.
No 24-word phrase to lose down the back of the couch.

The trade-off of self-custody: recovery is on you. That's what the PIN is for —
keep it safe. See [Security & Recovery](security.md).

## Selective disclosure

Privacy by default doesn't mean you can never prove anything. **Selective
disclosure** lets you voluntarily prove that one specific payment happened — for
your accountant, the tax office, or your bank — without revealing your other
payments. Private by default, provable by choice.

## Anchors (the crypto-to-bank bridge)

An **anchor** is a regulated service that converts crypto to regular money and
sends it to your bank. Olio connects to one for cash-out, and hands off the bank
details to them directly — Olio never touches your banking info.
