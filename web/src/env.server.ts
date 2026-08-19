import "server-only";

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
  SEP10_CLIENT_SIGNING_SECRET: optionalString,
  BRIDGE_SPONSOR_SECRET: optionalString,
  BRIDGE_FUNDING_XLM: z.preprocess(
    emptyToUndefined,
    z.string().trim().default("2.5"),
  ),
  CCTP_OPERATOR_SECRET: optionalString,
  CIRCLE_IRIS_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().url().default("https://iris-api-sandbox.circle.com"),
  ),
  CIRCLE_API_KEY: optionalString,
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI: process.env.MONGODB_URI,
    CRON_SECRET: process.env.CRON_SECRET,
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    OLIO_WALLET_DEPLOYER_SECRET: process.env.OLIO_WALLET_DEPLOYER_SECRET,
    OLIO_ACCOUNT_WASM_HASH: process.env.OLIO_ACCOUNT_WASM_HASH,
    CHANNELS_API_KEY: process.env.CHANNELS_API_KEY,
    CHANNELS_BASE_URL: process.env.CHANNELS_BASE_URL,
    SEP10_CLIENT_SIGNING_SECRET: process.env.SEP10_CLIENT_SIGNING_SECRET,
    BRIDGE_SPONSOR_SECRET: process.env.BRIDGE_SPONSOR_SECRET,
    BRIDGE_FUNDING_XLM: process.env.BRIDGE_FUNDING_XLM,
    CCTP_OPERATOR_SECRET: process.env.CCTP_OPERATOR_SECRET,
    CIRCLE_IRIS_URL: process.env.CIRCLE_IRIS_URL,
    CIRCLE_API_KEY: process.env.CIRCLE_API_KEY,
  });
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
