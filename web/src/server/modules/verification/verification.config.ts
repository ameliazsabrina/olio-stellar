import "server-only";
import { getServerEnv } from "../../../env.server";
import type { BusinessType, VerificationEnvironment } from "../../db/mongo";
import { VerificationConfigError } from "./verification.errors";

export const SUMSUB_API_ORIGIN = "https://api.sumsub.com";
export const SDK_TOKEN_TTL_SECONDS = 600;

export type SumsubMode = "off" | "sandbox" | "live";

export type VerificationConfig = {
  mode: SumsubMode;
  environment: VerificationEnvironment | null;
  appToken: string | null;
  secretKey: string | null;
  webhookSecret: string | null;
  webhookAlgorithm: "HMAC_SHA256_HEX" | "HMAC_SHA512_HEX";
  levels: Record<BusinessType, string | null>;
  expectedClientId: string | null;
  timeoutMs: number;
  policyVersion: number;
  workerEnabled: boolean;
  operatorIds: string[];
  productionRuntime: boolean;
};

export function verificationConfig(): VerificationConfig {
  const env = getServerEnv();
  const mode = env.SUMSUB_MODE;
  return {
    mode,
    environment: mode === "off" ? null : mode,
    appToken: env.SUMSUB_APP_TOKEN ?? null,
    secretKey: env.SUMSUB_SECRET_KEY ?? null,
    webhookSecret: env.SUMSUB_WEBHOOK_SECRET ?? null,
    webhookAlgorithm: env.SUMSUB_WEBHOOK_ALGORITHM,
    levels: {
      individual: env.SUMSUB_INDIVIDUAL_LEVEL ?? null,
      company: env.SUMSUB_COMPANY_LEVEL ?? null,
    },
    expectedClientId: env.SUMSUB_EXPECTED_CLIENT_ID ?? null,
    timeoutMs: env.SUMSUB_TIMEOUT_MS,
    policyVersion: env.VERIFICATION_POLICY_VERSION,
    workerEnabled: env.VERIFICATION_WORKER_ENABLED === "true",
    operatorIds: env.VERIFICATION_OPERATOR_PRIVY_IDS,
    productionRuntime: env.NODE_ENV === "production",
  };
}

export type ReadinessReason =
  | "disabled"
  | "credentials_missing"
  | "webhook_secret_missing"
  | "levels_missing"
  | "live_in_non_production";

export type Readiness =
  | { ready: true; environment: VerificationEnvironment }
  | { ready: false; reason: ReadinessReason };

export function readiness(config = verificationConfig()): Readiness {
  if (config.mode === "off" || !config.environment) {
    return { ready: false, reason: "disabled" };
  }
  if (!config.appToken || !config.secretKey) {
    return { ready: false, reason: "credentials_missing" };
  }
  if (!config.webhookSecret) {
    return { ready: false, reason: "webhook_secret_missing" };
  }
  if (!config.levels.individual || !config.levels.company) {
    return { ready: false, reason: "levels_missing" };
  }
  return { ready: true, environment: config.environment };
}

export function assertReady(config = verificationConfig()): {
  environment: VerificationEnvironment;
  config: VerificationConfig;
} {
  const state = readiness(config);
  if (!state.ready) {
    throw new VerificationConfigError(
      `Identity verification is not ready: ${state.reason}.`,
    );
  }
  return { environment: state.environment, config };
}

export function levelFor(type: BusinessType, config = verificationConfig()) {
  const level = config.levels[type];
  if (!level) {
    throw new VerificationConfigError(
      `No Sumsub level is configured for ${type} applicants.`,
    );
  }
  return level;
}

export function credentialEnvironmentAllowed(
  environment: VerificationEnvironment,
  config = verificationConfig(),
): boolean {
  if (config.environment !== environment) return false;
  if (config.productionRuntime && environment !== "live") return false;
  return true;
}
