// Circle CCTP V2 config, shared by the payer's EVM burn flow (client) and the
// Stellar receive/relay (server). Stellar is CCTP domain 27; a burn on any
// supported source domain that names our intake account as `mintRecipient`
// mints USDC on Stellar, which the relayer then deposits into the shielded pool
// as a note encrypted to the payee. Addresses are Circle's testnet deployments.

export const CCTP_STELLAR_DOMAIN = 27;

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

// The Stellar account CCTP mints into before the pool deposit. Public address is
// exposed so the payer's burn can target it; the secret is server-only.
export const cctpIntakeAddress =
  process.env.NEXT_PUBLIC_CCTP_INTAKE_ADDRESS || "";

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

// Circle Iris attestation service (sandbox for testnet).
export const irisBaseUrl = (
  process.env.CIRCLE_IRIS_URL || "https://iris-api-sandbox.circle.com"
).replace(/\/+$/, "");
