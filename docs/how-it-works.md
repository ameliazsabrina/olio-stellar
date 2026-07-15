# How Olio Works

There's a simple version and a nerdy version. Read whichever one you're in the
mood for.

## The simple explanation

Think of the blockchain as a public bulletin board. Normally, when someone pays
you, they pin a note to the board that says *"paid Dinar $50"* — for everyone to
see, forever.

Olio changes the note. Instead, your client pins up a **sealed envelope**. The
board only shows that *an envelope was pinned* — not who it's for or what's
inside. Only you have the key to open your envelopes.

When you want to spend the money, you don't rip the envelope off the board and
wave it around. Instead, you prove — mathematically — *"I own a valid, unopened
envelope worth $50"* without pointing to which one. The board pays you out, marks
that envelope as used so it can't be spent twice, and never learns which
deposit it came from.

That "prove it without revealing it" trick is the heart of Olio. It's what keeps
your payments unlinkable.

## The technical explanation

For the curious, here's what's really happening.

**Two keys per account.** When you claim a username, your browser makes two
keypairs and publishes only the *public* halves to an on-chain registry:

* a **note key** — controls who can spend a payment, and
* a **viewing key** — lets payers encrypt payment details so only you can read
  them.

**Payments become commitments.** A payment doesn't transfer USDC to your address.
Instead it deposits into a **shielded pool** contract, which stores a
*commitment* — a hash of `(amount, your public key, a random salt)` — as a leaf in
a Merkle tree. The pool holds the actual USDC in custody. Encrypted payment
details ride along in the event log.

**You scan for your own payments.** Your browser reads the pool's deposit events
and tries to decrypt each one with your viewing key. The ones that decrypt are
yours; the rest stay opaque. Nothing about this needs a server to know your
secrets.

**Spending uses a zero-knowledge proof.** To withdraw, your browser builds a
Merkle proof (your commitment is in the tree) and a **Groth16 zero-knowledge
proof** that says: *"I know the secret behind one of these commitments, and its
amount is X"* — without revealing which one. It also reveals a **nullifier**, a
one-time tag derived from your secret that lets the pool block double-spends
without linking back to your deposit.

**The pool verifies and pays.** The contract checks the proof using Stellar's
built-in cryptography, confirms the nullifier hasn't been used, records it, and
releases the USDC. Deposit and withdrawal are never publicly connected.

**You never touch gas.** A relayer sponsors the network fees and submits your
transactions, so you don't need to hold any network token. Your passkey signs;
the relayer pays and broadcasts. It can't move funds you didn't approve.

{% hint style="info" %}
Want the deeper cuts — the exact hashing, curve, and contract details? See
[Concepts](concepts.md) and the [Developer Reference](reference.md).
{% endhint %}
