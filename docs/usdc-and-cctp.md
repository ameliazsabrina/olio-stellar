# USDC & Cross-Chain Payments

## Why USDC

Olio runs on **USDC** — a digital dollar that always aims to be worth exactly
$1. That stability is exactly what you want for getting paid: the $50 a client
sends is still $50 when you cash out, not $43 or $61 because the market moved.

## Pay from Stellar

The simplest path: your client pays USDC on Stellar directly into Olio. It's
fast, costs a fraction of a cent in network fees (which Olio covers), and settles
in seconds.

Checkout shows the requested payment, the receiving client's 2% or 5% Olio
service fee, the payer's total,
and the unchanged recipient amount before authorization. The service fee is
added on top, never deducted from the private payment.

## Pay from another chain (CCTP)

Your client's USDC is on Ethereum, Base, Arbitrum, Avalanche, or Solana? No
problem. Olio uses Circle's **CCTP** — Cross-Chain Transfer Protocol — to bring
it over.

Here's the idea without the plumbing:

1. Your client burns the requested USDC plus the signed 2% or 5% Olio service fee on their own chain.
2. Circle officially confirms the burn happened.
3. The gross amount is created on Stellar. Olio sends the service fee to its
   treasury and places the full requested amount into a private note for you.

This is Circle's own audited, native mechanism — the USDC isn't wrapped or
IOU'd; it's real USDC recreated on the other side. To you, a cross-chain payment
looks exactly like any other: it just shows up as a private note in your balance.

The burn hook contains an opaque digest of the immutable signed payment terms.
Retries never re-price principal, recipient, source wallet, or total. If Circle's
attestation arrives after authorization expiry, Olio may renew only the time
window over those same terms.

Recovery also verifies the original source transaction and accepts a renewed
authorization only when the burn itself occurred before the original quote
expired. Mint and pool-deposit transaction hashes are checkpointed separately,
so a server restart can resume either step without minting or collecting twice.

### Chains you can pay from (testnet)

Choosing Base asks your wallet to switch to Base Sepolia automatically, or add the network if needed.

* Ethereum Sepolia
* Base Sepolia
* Arbitrum Sepolia
* Avalanche Fuji
* Solana Devnet

{% hint style="success" %}
The point: your clients pay from wherever their money already is, and you still
receive one clean, private balance on Stellar.
{% endhint %}
