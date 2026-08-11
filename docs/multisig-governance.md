# Multisig & Timelocked Governance

Olio's shielded pool uses two layers of protection for administrative actions:
a **2-of-3 Stellar multisig** and an immutable **48-hour timelock** for sensitive
changes.

This means one compromised or unavailable operator key is not enough to control
the pool.

## How the multisig works

The pool administrator is a native Stellar account with three signer keys. Each
key has weight 1, while administrative transactions require weight 2. Any two
signers can authorize an action; one signer acting alone cannot.

The 2-of-3 requirement protects:

* proposing a contract upgrade;
* proposing a replacement zero-knowledge verifier key;
* proposing a new pool administrator;
* pausing or unpausing the pool; and
* cancelling a pending governance proposal.

Using all three keys is not required for routine governance. The third key
provides resilience if one signer is unavailable.

## What the 48-hour timelock protects

Multisig approval does not make a sensitive change immediate. Contract upgrades,
verifier-key replacements, and administrator rotation are stored as public
on-chain proposals and cannot execute for 172,800 seconds.

Each proposal includes:

* a monotonically increasing proposal ID;
* the complete proposed action;
* a deterministic payload hash; and
* the exact execution timestamp.

During the delay, anyone can inspect the proposal, compare its payload hash with
the reviewed software or verifier artifact, and raise an alert. The multisig can
cancel the proposal immediately if anything is wrong.

After the deadline, anyone can execute a matured contract-upgrade or
verifier-key proposal. This is intentional: execution does not depend on an
operator remaining online after the public review window. Administrator
rotation also requires authorization from the proposed new administrator.

## Emergency powers and limits

Any two governance signers can immediately pause or unpause deposits, shielded
transfers, and withdrawals. They can also cancel a pending proposal. A pause can
temporarily prevent users from accessing the pool, so it is a real residual
trust assumption—not a claim that governance has no power.

The multisig cannot immediately activate new contract code, replace the proof
rules, or rotate governance. Those actions always require a public proposal and
the full 48-hour delay.

{% hint style="warning" %}
A timelock creates time for public review and response; it does not make a bad
proposal harmless. Users and operators must still monitor governance events and
verify reviewed hashes during every 48-hour window.
{% endhint %}

## Testnet rehearsal

The complete process has been rehearsed on Stellar Testnet with the live 2-of-3
account: single-signature authorization was rejected, two-signature proposal and
cancellation succeeded, and a reviewed same-code upgrade executed only after the
48-hour deadline. The contract code, administrator, configuration, verifier-key
status, pool root, leaf count, pause state, and token balance were verified as
unchanged after execution.

Olio is still testnet-stage and has not yet completed an independent security
audit. Mainnet operations must retain the same multisig, timelock, artifact
review, monitoring, and incident-response requirements.

For the broader security model and user recovery guidance, see
[Security & Recovery](security.md).
