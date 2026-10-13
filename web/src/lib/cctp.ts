// Circle CCTP V2 config, shared by the payer's EVM burn flow (client) and the
// Stellar receive/relay (server). Stellar is CCTP domain 27; a burn on any
// supported source domain that names our intake account as `mintRecipient`
// mints USDC on Stellar, which the relayer then deposits into the shielded pool
// as a note encrypted to the payee. Addresses are Circle's testnet deployments.

import { env } from "../env";
import { paymentBindingDigest, type SignedFeeQuote } from "./fee-quote";

export const CCTP_STELLAR_DOMAIN = 27;

// Salted commitment carried in the burn's hookData, binding the burn to a payee
// without revealing the payee on the public source chain. The payer generates a
// random 32-byte `nonce`; the relay recomputes this from the resolved payee's
// note key and rejects the deposit unless it matches the message's hookData.
// Second-preimage resistance means an attacker cannot redirect a victim's burn
// to a different username.
export function cctpBinding(quote: SignedFeeQuote): Uint8Array {
  if (quote.channel !== "cctp") {
    throw new RangeError("CCTP hook data requires a CCTP fee quote.");
  }
  return paymentBindingDigest(quote);
}

// Circle's Stellar (Soroban) CCTP V2 testnet contracts.
export const cctpStellar = {
  tokenMessengerMinter:
    env.NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER ||
    "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  messageTransmitter:
    env.NEXT_PUBLIC_CCTP_MESSAGE_TRANSMITTER ||
    "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
  forwarder:
    env.NEXT_PUBLIC_CCTP_FORWARDER ||
    "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
};

// The Stellar CCTP intake **contract** (C…) the minter credits before the pool
// deposit. Circle's Stellar minter always interprets the 32-byte mintRecipient
// as a contract id, so this must be a contract — not a G-account. Its C-address
// is public so the payer's burn can target it; the operator that forwards its
// balance into the pool is server-only (CCTP_OPERATOR_SECRET).
export const cctpIntakeContract = env.NEXT_PUBLIC_CCTP_INTAKE_CONTRACT || "";

export const EVM_CHAIN_KEYS = [
  "ethereum",
  "avalanche",
  "optimism",
  "arbitrum",
  "base",
  "polygon",
  "unichain",
  "linea",
  "codex",
  "sonic",
  "worldchain",
  "monad",
  "sei",
  "xdc",
  "hyperevm",
  "ink",
  "plume",
  "arc",
  "injective",
  "morph",
] as const;
export type EvmChainKey = (typeof EVM_CHAIN_KEYS)[number];

export type EvmSource = {
  domain: number;
  /** Stable slug used as the payer's chain choice. */
  key: EvmChainKey;
  /** Short display name for chain pickers. */
  label: string;
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  tokenMessenger: `0x${string}`;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorerTx: string;
};

// Circle CCTP V2 testnet source chains. TokenMessengerV2 shares one address
// across EVM testnets; USDC differs per chain. Every entry was checked against
// Stellar's TokenMessengerMinter: `get_remote_token_messenger(domain)` is this
// messenger and `get_local_token(domain, usdc)` is our USDC SAC, so a burn from
// any of them mints on Stellar. Each domain still needs a certified route in
// CCTP_ROUTE_MANIFEST before payers can use it.
const TOKEN_MESSENGER_V2 =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;

export const EVM_SOURCES: Record<number, EvmSource> = {
  0: {
    domain: 0,
    key: "ethereum",
    label: "Ethereum",
    chainId: 11155111,
    name: "Ethereum Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.etherscan.io/tx/",
  },
  1: {
    domain: 1,
    key: "avalanche",
    label: "Avalanche",
    chainId: 43113,
    name: "Avalanche Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.snowtrace.io/tx/",
  },
  2: {
    domain: 2,
    key: "optimism",
    label: "OP Mainnet",
    chainId: 11155420,
    name: "OP Sepolia",
    rpcUrl: "https://sepolia.optimism.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia-optimism.etherscan.io/tx/",
  },
  3: {
    domain: 3,
    key: "arbitrum",
    label: "Arbitrum",
    chainId: 421614,
    name: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.arbiscan.io/tx/",
  },
  6: {
    domain: 6,
    key: "base",
    label: "Base",
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.basescan.org/tx/",
  },
  7: {
    domain: 7,
    key: "polygon",
    label: "Polygon",
    chainId: 80002,
    name: "Polygon Amoy",
    rpcUrl: "https://polygon-amoy-bor-rpc.publicnode.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://amoy.polygonscan.com/tx/",
  },
  10: {
    domain: 10,
    key: "unichain",
    label: "Unichain",
    chainId: 1301,
    name: "Unichain Sepolia",
    rpcUrl: "https://sepolia.unichain.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.uniscan.xyz/tx/",
  },
  11: {
    domain: 11,
    key: "linea",
    label: "Linea",
    chainId: 59141,
    name: "Linea Sepolia",
    rpcUrl: "https://rpc.sepolia.linea.build",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.lineascan.build/tx/",
  },
  12: {
    domain: 12,
    key: "codex",
    label: "Codex",
    chainId: 812242,
    name: "Codex Testnet",
    rpcUrl: "https://rpc.codex-stg.xyz",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://explorer.codex-stg.xyz/tx/",
  },
  13: {
    domain: 13,
    key: "sonic",
    label: "Sonic",
    chainId: 14601,
    name: "Sonic Testnet",
    rpcUrl: "https://rpc.testnet.soniclabs.com",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    usdc: "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.sonicscan.org/tx/",
  },
  14: {
    domain: 14,
    key: "worldchain",
    label: "World Chain",
    chainId: 4801,
    name: "World Chain Sepolia",
    rpcUrl: "https://worldchain-sepolia.g.alchemy.com/public",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://sepolia.worldscan.org/tx/",
  },
  15: {
    domain: 15,
    key: "monad",
    label: "Monad",
    chainId: 10143,
    name: "Monad Testnet",
    rpcUrl: "https://testnet-rpc.monad.xyz",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.monadscan.com/tx/",
  },
  16: {
    domain: 16,
    key: "sei",
    label: "Sei",
    chainId: 1328,
    name: "Sei Testnet",
    rpcUrl: "https://evm-rpc-testnet.sei-apis.com",
    nativeCurrency: { name: "Sei", symbol: "SEI", decimals: 18 },
    usdc: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.seistream.app/transactions/",
  },
  18: {
    domain: 18,
    key: "xdc",
    label: "XDC",
    chainId: 51,
    name: "XDC Apothem",
    rpcUrl: "https://rpc.apothem.network",
    nativeCurrency: { name: "XDC", symbol: "TXDC", decimals: 18 },
    usdc: "0xb5AB69F7bBada22B28e79C8FFAECe55eF1c771D4",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.xdcscan.com/tx/",
  },
  19: {
    domain: 19,
    key: "hyperevm",
    label: "HyperEVM",
    chainId: 998,
    name: "HyperEVM Testnet",
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    usdc: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.purrsec.info/tx/",
  },
  21: {
    domain: 21,
    key: "ink",
    label: "Ink",
    chainId: 763373,
    name: "Ink Sepolia",
    rpcUrl: "https://rpc-gel-sepolia.inkonchain.com",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0xFabab97dCE620294D2B0b0e46C68964e326300Ac",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://explorer-sepolia.inkonchain.com/tx/",
  },
  22: {
    domain: 22,
    key: "plume",
    label: "Plume",
    chainId: 98867,
    name: "Plume Testnet",
    rpcUrl: "https://testnet-rpc.plume.org",
    nativeCurrency: { name: "Plume", symbol: "PLUME", decimals: 18 },
    usdc: "0xcB5f30e335672893c7eb944B374c196392C19D18",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet-explorer.plume.org/tx/",
  },
  26: {
    domain: 26,
    key: "arc",
    label: "Arc",
    chainId: 5042002,
    name: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.network",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    usdc: "0x3600000000000000000000000000000000000000",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.arcscan.app/tx/",
  },
  29: {
    domain: 29,
    key: "injective",
    label: "Injective",
    chainId: 1439,
    name: "Injective EVM Testnet",
    rpcUrl: "https://k8s.testnet.json-rpc.injective.network",
    nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
    usdc: "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://testnet.blockscout.injective.network/tx/",
  },
  30: {
    domain: 30,
    key: "morph",
    label: "Morph",
    chainId: 2910,
    name: "Morph Hoodi",
    rpcUrl: "https://rpc-hoodi.morph.network",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    usdc: "0x7433b41C6c5e1d58D4Da99483609520255ab661B",
    tokenMessenger: TOKEN_MESSENGER_V2,
    explorerTx: "https://explorer-hoodi.morph.network/tx/",
  },
};

export const evmSourceByChainId = (chainId: number): EvmSource | undefined =>
  Object.values(EVM_SOURCES).find((s) => s.chainId === chainId);

// Circle CCTP V2 Solana source (devnet). Solana is source domain 5. The V2
// program IDs are the same `CCTPV2…` addresses on every cluster; only the USDC
// mint differs. Mainnet requires a separate certified registry, not a URL swap. A Solana burn produces the same normalized CCTP message as an EVM burn,
// so the server relay is chain-agnostic and needs no Solana awareness.
export const SOLANA_SRC_DOMAIN = 5;

// "evm" follows the connected wallet's network; every other choice pins the
// quote and readiness to one domain.
export type CctpChain = "evm" | "solana" | EvmChainKey;
export const CCTP_CHAIN_DOMAIN: Partial<Record<CctpChain, number>> = {
  solana: SOLANA_SRC_DOMAIN,
  ...Object.fromEntries(
    Object.values(EVM_SOURCES).map((source) => [source.key, source.domain]),
  ),
};
export const evmSourceForChain = (chain: CctpChain): EvmSource | undefined => {
  const domain = CCTP_CHAIN_DOMAIN[chain];
  return domain === undefined ? undefined : EVM_SOURCES[domain];
};

/** Every CCTP source domain Olio can quote and relay. */
export const CCTP_SOURCE_DOMAINS: readonly number[] = [
  ...Object.keys(EVM_SOURCES).map(Number),
  SOLANA_SRC_DOMAIN,
].sort((a, b) => a - b);

export type SolanaSource = {
  domain: typeof SOLANA_SRC_DOMAIN;
  name: string;
  usdcMint: string;
  tokenMessengerMinter: string;
  messageTransmitter: string;
  explorerTx: string;
};

export const solanaSource: SolanaSource = {
  domain: SOLANA_SRC_DOMAIN,
  name: "Solana Devnet",
  // Circle's CCTP-burnable devnet USDC faucet mint (faucet.circle.com).
  usdcMint:
    env.NEXT_PUBLIC_SOLANA_USDC_MINT ||
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  tokenMessengerMinter: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
  explorerTx: "https://explorer.solana.com/tx/",
};

export const cctpRpcPath = (domain: number) => `/api/cctp/rpc/${domain}`;
