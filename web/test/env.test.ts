import { afterEach, describe, expect, it, vi } from "vitest";
import { publicEnvSchema } from "../src/env";
import { getServerEnv, serverEnvSchema } from "../src/env.server";
import { poolCollectionName } from "../src/server/db/mongo";

afterEach(() => vi.unstubAllEnvs());

describe("environment schemas", () => {
  it("normalizes public defaults and typed numeric values", () => {
    const parsed = publicEnvSchema.parse({
      NODE_ENV: "test",
      NEXT_PUBLIC_POOL_DEPTH: "24",
      NEXT_PUBLIC_STELLAR_RPC_URL: "",
    });

    expect(parsed.NEXT_PUBLIC_POOL_DEPTH).toBe(24);
    expect(parsed.NEXT_PUBLIC_STELLAR_RPC_URL).toBeUndefined();
  });

  it("rejects malformed public URLs and numeric ranges", () => {
    expect(() =>
      publicEnvSchema.parse({ NEXT_PUBLIC_STELLAR_RPC_URL: "not-a-url" }),
    ).toThrow();
    expect(() =>
      publicEnvSchema.parse({ NEXT_PUBLIC_POOL_DEPTH: "0" }),
    ).toThrow();
  });

  it("keeps blank optional secrets absent and validates server URLs", () => {
    const parsed = serverEnvSchema.parse({
      NODE_ENV: "test",
      PRIVY_APP_SECRET: "  ",
    });
    expect(parsed.PRIVY_APP_SECRET).toBeUndefined();

    expect(() =>
      serverEnvSchema.parse({ CHANNELS_BASE_URL: "channels.example" }),
    ).toThrow();
  });

  it("requires the fee signer at production runtime when a pool is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("NEXT_PUBLIC_OLIO_POOL_ID", "CPOOL");
    vi.stubEnv("FEE_QUOTE_SIGNING_SECRET", "");
    expect(() => getServerEnv()).toThrow("FEE_QUOTE_SIGNING_SECRET");
  });

  it("keeps identity verification off and unconfigured by default", () => {
    const parsed = serverEnvSchema.parse({ NODE_ENV: "test" });
    expect(parsed.SUMSUB_MODE).toBe("off");
    expect(parsed.SUMSUB_WEBHOOK_ALGORITHM).toBe("HMAC_SHA256_HEX");
    expect(parsed.VERIFICATION_WORKER_ENABLED).toBe("false");
    expect(parsed.VERIFICATION_POLICY_VERSION).toBe(1);
    expect(parsed.VERIFICATION_OPERATOR_PRIVY_IDS).toEqual([]);
  });

  it("rejects a webhook algorithm outside the supported set", () => {
    expect(() =>
      serverEnvSchema.parse({ SUMSUB_WEBHOOK_ALGORITHM: "HMAC_SHA1_HEX" }),
    ).toThrow();
  });

  it("parses the operator allowlist as a trimmed list", () => {
    expect(
      serverEnvSchema.parse({
        VERIFICATION_OPERATOR_PRIVY_IDS: " did:privy:a , did:privy:b ,",
      }).VERIFICATION_OPERATOR_PRIVY_IDS,
    ).toEqual(["did:privy:a", "did:privy:b"]);
  });

  it("requires the full Sumsub configuration at production runtime in live mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("SUMSUB_MODE", "live");
    vi.stubEnv("SUMSUB_APP_TOKEN", "token");
    vi.stubEnv("SUMSUB_SECRET_KEY", "secret");
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "");
    vi.stubEnv("SUMSUB_INDIVIDUAL_LEVEL", "olio-individual");
    vi.stubEnv("SUMSUB_COMPANY_LEVEL", "olio-company");
    expect(() => getServerEnv()).toThrow("SUMSUB_WEBHOOK_SECRET");
  });

  it("does not require Sumsub configuration while the mode is off", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("SUMSUB_MODE", "off");
    expect(getServerEnv().SUMSUB_MODE).toBe("off");
  });

  it("isolates pool collections when a storage scope is configured", () => {
    vi.stubEnv("MONGO_POOL_STORAGE_SCOPE", "CPOOL_123");
    expect(poolCollectionName("deposits")).toBe("deposits__CPOOL_123");
    expect(poolCollectionName("client_fee_policies", undefined)).toBe(
      "client_fee_policies__CPOOL_123",
    );
    expect(() =>
      serverEnvSchema.parse({ MONGO_POOL_STORAGE_SCOPE: "invalid scope" }),
    ).toThrow();
  });
});
