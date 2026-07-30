import { Keypair, Networks } from "@stellar/stellar-sdk";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

it("serves the public SEP-10 client-attribution key", async () => {
  const keypair = Keypair.random();
  vi.stubEnv("SEP10_CLIENT_SIGNING_SECRET", keypair.secret());
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.PUBLIC);
  const { GET } = await import("../src/app/.well-known/stellar.toml/route");

  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const body = await response.text();
  expect(body).toContain(`NETWORK_PASSPHRASE="${Networks.PUBLIC}"`);
  expect(body).toContain(`SIGNING_KEY="${keypair.publicKey()}"`);
});

it("advertises the configured testnet passphrase", async () => {
  const keypair = Keypair.random();
  vi.stubEnv("SEP10_CLIENT_SIGNING_SECRET", keypair.secret());
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.TESTNET);
  const { GET } = await import("../src/app/.well-known/stellar.toml/route");

  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(
    `NETWORK_PASSPHRASE="${Networks.TESTNET}"`,
  );
});

it("returns unavailable rather than advertising an unconfigured key", async () => {
  vi.stubEnv("SEP10_CLIENT_SIGNING_SECRET", "");
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.PUBLIC);
  const { GET } = await import("../src/app/.well-known/stellar.toml/route");
  expect(GET().status).toBe(503);
});
