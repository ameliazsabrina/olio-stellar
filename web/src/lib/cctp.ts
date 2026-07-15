// Circle CCTP V2 config, shared by the payer's EVM burn flow (client) and the
// Stellar receive/relay (server). Stellar is CCTP domain 27; a burn on any
// supported source domain that names our intake account as `mintRecipient`
// mints USDC on Stellar, which the relayer then deposits into the shielded pool
// as a note encrypted to the payee. Addresses are Circle's testnet deployments.

import { keccak_256 } from "@noble/hashes/sha3.js";

export const CCTP_STELLAR_DOMAIN = 27;

// Salted commitment carried in the burn's hookData, binding the burn to a payee
// without revealing the payee on the public source chain. The payer generates a
// random 32-byte `nonce`; the relay recomputes this from the resolved payee's
// note key and rejects the deposit unless it matches the message's hookData.
// Second-preimage resistance means an attacker cannot redirect a victim's burn
// to a different username.
export function cctpBinding(
  notePubkey: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  const buf = new Uint8Array(notePubkey.length + nonce.length);
  buf.set(notePubkey, 0);
  buf.set(nonce, notePubkey.length);
  return keccak_256(buf);
}

// Circle's Stellar (Soroban) CCTP V2 testnet contracts.
export const cctpStellar = {
  tokenMessengerMinter:
    process.env.NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER ||
    "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  messageTransmitter:
    process.env.NEXT_PUBLIC_CCTP_MESSAGE_TRANSMITTER ||
    "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
  forwarder:
    process.env.NEXT_PUBLIC_CCTP_FORWARDER ||
    "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
};

// The Stellar CCTP intake **contract** (C…) the minter credits before the pool
// deposit. Circle's Stellar minter always interprets the 32-byte mintRecipient
// as a contract id, so this must be a contract — not a G-account. Its C-address
// is public so the payer's burn can target it; the operator that forwards its
// balance into the pool is server-only (CCTP_OPERATOR_SECRET).
export const cctpIntakeContract =
  process.env.NEXT_PUBLIC_CCTP_INTAKE_CONTRACT || "";

export type EvmSource = {
  domain: number;
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  tokenMessenger: `0x${string}`;
  explorerTx: string;
};

// Circle CCTP V2 testnet source chains. TokenMessengerV2 shares one address
// across EVM testnets; USDC differs per chain.
const TOKEN_MESSENGER_V2 =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;

export const EVM_SOURCES: Record<number, EvmSource> = {
  0: {
    domain: 0,
    chainId: 11155111,
    name: "Ethereum Sepolia",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.etherscan.io/tx/",
  },
  1: {
    domain: 1,
    chainId: 43113,
    name: "Avalanche Fuji",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.snowtrace.io/tx/",
  },
  3: {
    domain: 3,
    chainId: 421614,
    name: "Arbitrum Sepolia",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.arbiscan.io/tx/",
  },
  6: {
    domain: 6,
    chainId: 84532,
    name: "Base Sepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.basescan.org/tx/",
  },
};

export const evmSourceByChainId = (chainId: number): EvmSource | undefined =>
  Object.values(EVM_SOURCES).find((s) => s.chainId === chainId);

// Circle CCTP V2 Solana source (devnet). Solana is source domain 5. The V2
// program IDs are the same `CCTPV2…` addresses on every cluster; only the USDC
// mint and RPC endpoint differ, so those are env-overridable for a later mainnet
// swap. A Solana burn produces the same normalized CCTP message as an EVM burn,
// so the server relay is chain-agnostic and needs no Solana awareness.
export const SOLANA_SRC_DOMAIN = 5;

export type SolanaSource = {
  domain: typeof SOLANA_SRC_DOMAIN;
  name: string;
  usdcMint: string;
  tokenMessengerMinter: string;
  messageTransmitter: string;
  rpcUrl: string;
  explorerTx: string;
};

export const solanaSource: SolanaSource = {
  domain: SOLANA_SRC_DOMAIN,
  name: "Solana Devnet",
  // Circle's CCTP-burnable devnet USDC faucet mint (faucet.circle.com).
  usdcMint:
    process.env.NEXT_PUBLIC_SOLANA_USDC_MINT ||
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  tokenMessengerMinter: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
  rpcUrl:
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com",
  explorerTx: "https://explorer.solana.com/tx/",
};

// Circle Iris attestation service (sandbox for testnet).
export const irisBaseUrl = (
  process.env.CIRCLE_IRIS_URL || "https://iris-api-sandbox.circle.com"
).replace(/\/+$/, "");
