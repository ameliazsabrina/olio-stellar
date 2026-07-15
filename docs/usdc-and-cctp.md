# USDC & Cross-Chain Payments

## Why USDC

Olio runs on **USDC** — a digital dollar that always aims to be worth exactly
$1. That stability is exactly what you want for getting paid: the $50 a client
sends is still $50 when you cash out, not $43 or $61 because the market moved.

## Pay from Stellar

The simplest path: your client pays USDC on Stellar directly into Olio. It's
fast, costs a fraction of a cent in network fees (which Olio covers), and settles
in seconds.

## Pay from another chain (CCTP)

Your client's USDC is on Ethereum, Base, Arbitrum, Avalanche, or Solana? No
problem. Olio uses Circle's **CCTP** — Cross-Chain Transfer Protocol — to bring
it over.

Here's the idea without the plumbing:

1. Your client "burns" (destroys) their USDC on their own chain.
2. Circle officially confirms the burn happened.
3. That same amount of USDC is freshly created on Stellar and dropped straight
   into Olio as a private payment to you.

This is Circle's own audited, native mechanism — the USDC isn't wrapped or
IOU'd; it's real USDC recreated on the other side. To you, a cross-chain payment
looks exactly like any other: it just shows up as a private note in your balance.

### Chains you can pay from (testnet)

* Ethereum Sepolia
* Base Sepolia
* Arbitrum Sepolia
* Avalanche Fuji
* Solana Devnet

{% hint style="success" %}
The point: your clients pay from wherever their money already is, and you still
receive one clean, private balance on Stellar.
{% endhint %}
