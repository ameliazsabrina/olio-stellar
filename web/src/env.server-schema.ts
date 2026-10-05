import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MONGODB_URI: optionalString,
  MONGO_POOL_STORAGE_SCOPE: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  ),
  CRON_SECRET: optionalString,
  PRIVY_APP_ID: optionalString,
  PRIVY_APP_SECRET: optionalString,
  OLIO_WALLET_DEPLOYER_SECRET: optionalString,
  OLIO_ACCOUNT_WASM_HASH: optionalString,
  CHANNELS_API_KEY: optionalString,
  CHANNELS_BASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .url()
      .default("https://channels.openzeppelin.com/testnet"),
  ),
  BRIDGE_SPONSOR_SECRET: optionalString,
  BRIDGE_FUNDING_XLM: z.preprocess(
    emptyToUndefined,
    z.string().trim().default("2.5"),
  ),
  CCTP_OPERATOR_SECRET: optionalString,
  CCTP_ROUTE_MANIFEST: optionalString,
  CCTP_SESSION_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
  ),
  CCTP_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
  CCTP_IRIS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(10000),
  CCTP_IRIS_RPS: z.coerce.number().int().min(1).max(10).default(10),
  CCTP_SOURCE_RPC_URLS: optionalString,
  CIRCLE_IRIS_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().url().default("https://iris-api-sandbox.circle.com"),
  ),
  CIRCLE_API_KEY: optionalString,
  FEE_QUOTE_SIGNING_SECRET: optionalString,
  SUMSUB_MODE: z.enum(["off", "sandbox", "live"]).default("off"),
  SUMSUB_APP_TOKEN: optionalString,
  SUMSUB_SECRET_KEY: optionalString,
  SUMSUB_WEBHOOK_SECRET: optionalString,
  SUMSUB_WEBHOOK_ALGORITHM: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.enum(["HMAC_SHA256_HEX", "HMAC_SHA512_HEX"]).default("HMAC_SHA256_HEX"),
  ),
  SUMSUB_INDIVIDUAL_LEVEL: optionalString,
  SUMSUB_COMPANY_LEVEL: optionalString,
  SUMSUB_EXPECTED_CLIENT_ID: optionalString,
  SUMSUB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
  VERIFICATION_POLICY_VERSION: z.coerce.number().int().min(1).default(1),
  VERIFICATION_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
  VERIFICATION_OPERATOR_PRIVY_IDS: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ),
});

export function getServerEnv() {
  const parsed = serverEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI: process.env.MONGODB_URI,
    MONGO_POOL_STORAGE_SCOPE: process.env.MONGO_POOL_STORAGE_SCOPE,
    CRON_SECRET: process.env.CRON_SECRET,
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    OLIO_WALLET_DEPLOYER_SECRET: process.env.OLIO_WALLET_DEPLOYER_SECRET,
    OLIO_ACCOUNT_WASM_HASH: process.env.OLIO_ACCOUNT_WASM_HASH,
    CHANNELS_API_KEY: process.env.CHANNELS_API_KEY,
    CHANNELS_BASE_URL: process.env.CHANNELS_BASE_URL,
    BRIDGE_SPONSOR_SECRET: process.env.BRIDGE_SPONSOR_SECRET,
    BRIDGE_FUNDING_XLM: process.env.BRIDGE_FUNDING_XLM,
    CCTP_OPERATOR_SECRET: process.env.CCTP_OPERATOR_SECRET,
    CCTP_ROUTE_MANIFEST: process.env.CCTP_ROUTE_MANIFEST,
    CCTP_SESSION_KEY: process.env.CCTP_SESSION_KEY,
    CCTP_WORKER_ENABLED: process.env.CCTP_WORKER_ENABLED,
    CCTP_IRIS_TIMEOUT_MS: process.env.CCTP_IRIS_TIMEOUT_MS,
    CCTP_IRIS_RPS: process.env.CCTP_IRIS_RPS,
    CCTP_SOURCE_RPC_URLS: process.env.CCTP_SOURCE_RPC_URLS,
    CIRCLE_IRIS_URL: process.env.CIRCLE_IRIS_URL,
    CIRCLE_API_KEY: process.env.CIRCLE_API_KEY,
    FEE_QUOTE_SIGNING_SECRET: process.env.FEE_QUOTE_SIGNING_SECRET,
    SUMSUB_MODE: process.env.SUMSUB_MODE,
    SUMSUB_APP_TOKEN: process.env.SUMSUB_APP_TOKEN,
    SUMSUB_SECRET_KEY: process.env.SUMSUB_SECRET_KEY,
    SUMSUB_WEBHOOK_SECRET: process.env.SUMSUB_WEBHOOK_SECRET,
    SUMSUB_WEBHOOK_ALGORITHM: process.env.SUMSUB_WEBHOOK_ALGORITHM,
    SUMSUB_INDIVIDUAL_LEVEL: process.env.SUMSUB_INDIVIDUAL_LEVEL,
    SUMSUB_COMPANY_LEVEL: process.env.SUMSUB_COMPANY_LEVEL,
    SUMSUB_EXPECTED_CLIENT_ID: process.env.SUMSUB_EXPECTED_CLIENT_ID,
    SUMSUB_TIMEOUT_MS: process.env.SUMSUB_TIMEOUT_MS,
    VERIFICATION_POLICY_VERSION: process.env.VERIFICATION_POLICY_VERSION,
    VERIFICATION_WORKER_ENABLED: process.env.VERIFICATION_WORKER_ENABLED,
    VERIFICATION_OPERATOR_PRIVY_IDS:
      process.env.VERIFICATION_OPERATOR_PRIVY_IDS,
  });
  if (
    parsed.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.NEXT_PUBLIC_OLIO_POOL_ID &&
    !parsed.FEE_QUOTE_SIGNING_SECRET
  ) {
    throw new Error(
      "FEE_QUOTE_SIGNING_SECRET must be configured when production payment ingress is enabled.",
    );
  }
  if (
    parsed.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    parsed.SUMSUB_MODE === "live" &&
    (!parsed.SUMSUB_APP_TOKEN ||
      !parsed.SUMSUB_SECRET_KEY ||
      !parsed.SUMSUB_WEBHOOK_SECRET ||
      !parsed.SUMSUB_INDIVIDUAL_LEVEL ||
      !parsed.SUMSUB_COMPANY_LEVEL)
  ) {
    throw new Error(
      "SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY, SUMSUB_WEBHOOK_SECRET and both SUMSUB_*_LEVEL values must be configured when SUMSUB_MODE=live.",
    );
  }
  return parsed;
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
