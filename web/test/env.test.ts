import { describe, expect, it } from "vitest";
import { publicEnvSchema } from "../src/env";
import { serverEnvSchema } from "../src/env.server";

describe("environment schemas", () => {
  it("normalizes public defaults and typed numeric values", () => {
    const parsed = publicEnvSchema.parse({
      NODE_ENV: "test",
      NEXT_PUBLIC_POOL_DEPTH: "24",
      NEXT_PUBLIC_STELLAR_RPC_URL: "",
    });

    expect(parsed.NEXT_PUBLIC_POOL_DEPTH).toBe(24);
    expect(parsed.NEXT_PUBLIC_STELLAR_RPC_URL).toBeUndefined();
    expect(parsed.NEXT_PUBLIC_TRANSAK_ENV).toBe("PRODUCTION");
    expect(parsed.NEXT_PUBLIC_MONEYGRAM_RAMP_STATUS).toBe("whitelisting");
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
});
