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
