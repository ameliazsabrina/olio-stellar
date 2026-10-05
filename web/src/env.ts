import { z } from "zod";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url().optional(),
);

export const publicEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_STELLAR_NETWORK: z
    .enum(["testnet", "mainnet"])
    .default("testnet"),
  NEXT_PUBLIC_STELLAR_RPC_URL: optionalUrl,
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .trim()
    .min(1)
    .default(TESTNET_PASSPHRASE),
  NEXT_PUBLIC_OLIO_REGISTRY_ID: optionalString,
  NEXT_PUBLIC_OLIO_POOL_ID: optionalString,
  NEXT_PUBLIC_USDC_SAC_ID: optionalString,
  NEXT_PUBLIC_USDC_ISSUER: optionalString,
  NEXT_PUBLIC_POOL_DEPTH: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(32).default(20),
  ),
  NEXT_PUBLIC_PRIVY_APP_ID: optionalString,
  NEXT_PUBLIC_STELLAR_HORIZON_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().url().default("https://horizon-testnet.stellar.org"),
  ),
  NEXT_PUBLIC_FRIENDBOT_URL: optionalUrl,
  NEXT_PUBLIC_CCTP_INTAKE_CONTRACT: optionalString,
  NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER: optionalString,
  NEXT_PUBLIC_CCTP_MESSAGE_TRANSMITTER: optionalString,
  NEXT_PUBLIC_CCTP_FORWARDER: optionalString,
  NEXT_PUBLIC_SOLANA_RPC_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().url().default("https://api.devnet.solana.com"),
  ),
  NEXT_PUBLIC_SOLANA_USDC_MINT: optionalString,
});

/**
 * Keep every public variable as a direct property access. Next.js only embeds
 * NEXT_PUBLIC_* values in browser bundles when it can see this static form.
 */
export function getPublicEnv() {
  return publicEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
    NEXT_PUBLIC_OLIO_REGISTRY_ID: process.env.NEXT_PUBLIC_OLIO_REGISTRY_ID,
    NEXT_PUBLIC_OLIO_POOL_ID: process.env.NEXT_PUBLIC_OLIO_POOL_ID,
    NEXT_PUBLIC_USDC_SAC_ID: process.env.NEXT_PUBLIC_USDC_SAC_ID,
    NEXT_PUBLIC_USDC_ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER,
    NEXT_PUBLIC_POOL_DEPTH: process.env.NEXT_PUBLIC_POOL_DEPTH,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    NEXT_PUBLIC_STELLAR_HORIZON_URL:
      process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
    NEXT_PUBLIC_FRIENDBOT_URL: process.env.NEXT_PUBLIC_FRIENDBOT_URL,
    NEXT_PUBLIC_CCTP_INTAKE_CONTRACT:
      process.env.NEXT_PUBLIC_CCTP_INTAKE_CONTRACT,
    NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER:
      process.env.NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER,
    NEXT_PUBLIC_CCTP_MESSAGE_TRANSMITTER:
      process.env.NEXT_PUBLIC_CCTP_MESSAGE_TRANSMITTER,
    NEXT_PUBLIC_CCTP_FORWARDER: process.env.NEXT_PUBLIC_CCTP_FORWARDER,
    NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    NEXT_PUBLIC_SOLANA_USDC_MINT: process.env.NEXT_PUBLIC_SOLANA_USDC_MINT,
  });
}

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const env: PublicEnv = getPublicEnv();
