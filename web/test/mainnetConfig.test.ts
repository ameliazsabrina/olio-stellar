import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

it("requires an explicit RPC provider on mainnet", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    "Public Global Stellar Network ; September 2015",
  );
  vi.stubEnv("NEXT_PUBLIC_STELLAR_RPC_URL", "");

  await expect(import("../src/lib/stellar")).rejects.toThrow(
    "NEXT_PUBLIC_STELLAR_RPC_URL must be configured for mainnet.",
  );
});

it("does not fall back to the test anchor when mainnet SEP-24 is blank", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    "Public Global Stellar Network ; September 2015",
  );
  vi.stubEnv("NEXT_PUBLIC_STELLAR_RPC_URL", "https://rpc.example");
  vi.stubEnv("NEXT_PUBLIC_SEP24_ANCHOR_URL", "");
  vi.stubEnv(
    "NEXT_PUBLIC_USDC_ISSUER",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  );

  const { anchorHomeDomain, offRampEnabled } = await import(
    "../src/lib/anchor"
  );
  expect(anchorHomeDomain).toBe("");
  expect(offRampEnabled).toBe(false);
});

it("keeps mainnet SEP-24 disabled until a client domain is configured", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    "Public Global Stellar Network ; September 2015",
  );
  vi.stubEnv("NEXT_PUBLIC_STELLAR_RPC_URL", "https://rpc.example");
  vi.stubEnv(
    "NEXT_PUBLIC_SEP24_ANCHOR_URL",
    "https://previewstellar.moneygram.com",
  );
  vi.stubEnv(
    "NEXT_PUBLIC_USDC_ISSUER",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  );
  vi.stubEnv("NEXT_PUBLIC_SEP10_CLIENT_DOMAIN", "");

  const { offRampEnabled } = await import("../src/lib/anchor");
  expect(offRampEnabled).toBe(false);
});
