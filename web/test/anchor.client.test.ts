import { Keypair, Networks, StellarToml, WebAuth } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const signClientChallenge = vi.hoisted(() => vi.fn());

vi.mock("../src/trpc/client", () => ({
  api: {
    anchor: { signClientChallenge: { mutate: signClientChallenge } },
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses client-domain attribution for mainnet SEP-10", async () => {
  const anchor = Keypair.random();
  const bridge = Keypair.random();
  const clientSigningKey = Keypair.random();
  const anchorDomain = "previewstellar.moneygram.com";
  const clientDomain = "preview.olio.example";
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.PUBLIC);
  vi.stubEnv("NEXT_PUBLIC_STELLAR_RPC_URL", "https://rpc.example");
  vi.stubEnv("NEXT_PUBLIC_SEP10_CLIENT_DOMAIN", clientDomain);

  const challenge = WebAuth.buildChallengeTx(
    anchor,
    bridge.publicKey(),
    anchorDomain,
    300,
    Networks.PUBLIC,
    anchorDomain,
    null,
    clientDomain,
    clientSigningKey.publicKey(),
  );
  signClientChallenge.mockResolvedValue({
    signedTransactionXdr: "domain-signed-xdr",
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transaction: challenge,
        network_passphrase: Networks.PUBLIC,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "sep10-token" }),
    });
  vi.stubGlobal("fetch", fetchMock);

  const { authenticate } = await import("../src/lib/anchor");
  await expect(
    authenticate(
      {
        homeDomain: anchorDomain,
        webAuthEndpoint: `https://${anchorDomain}/auth`,
        transferServer: `https://${anchorDomain}/sep24`,
        signingKey: anchor.publicKey(),
      },
      bridge,
    ),
  ).resolves.toBe("sep10-token");

  const challengeUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
  expect(challengeUrl.searchParams.get("client_domain")).toBe(clientDomain);
  expect(signClientChallenge).toHaveBeenCalledWith({
    transactionXdr: expect.any(String),
    bridgePublicKey: bridge.publicKey(),
  });
  expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
    transaction: "domain-signed-xdr",
  });
});

it("rejects a mainnet anchor that advertises a different USDC issuer", async () => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.PUBLIC);
  vi.stubEnv("NEXT_PUBLIC_STELLAR_RPC_URL", "https://rpc.example");
  vi.stubEnv(
    "NEXT_PUBLIC_USDC_ISSUER",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  );
  vi.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({
    NETWORK_PASSPHRASE: Networks.PUBLIC,
    SIGNING_KEY: Keypair.random().publicKey(),
    WEB_AUTH_ENDPOINT: "https://anchor.example/auth",
    TRANSFER_SERVER_SEP0024: "https://anchor.example/sep24",
    CURRENCIES: [
      { code: "USDC", issuer: Keypair.random().publicKey(), status: "live" },
    ],
  });

  const { fetchAnchorInfo } = await import("../src/lib/anchor");
  await expect(fetchAnchorInfo("https://anchor.example")).rejects.toThrow(
    "Anchor does not advertise the configured USDC asset.",
  );
});

it("fails immediately on terminal SEP-24 statuses", async () => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.TESTNET);
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_RPC_URL",
    "https://soroban-testnet.stellar.org",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: { id: "withdraw-1", status: "no_market" },
      }),
    }),
  );
  const { pollSep24Until } = await import("../src/lib/anchor");
  await expect(
    pollSep24Until(
      {
        homeDomain: "anchor.example",
        webAuthEndpoint: "https://anchor.example/auth",
        transferServer: "https://anchor.example/sep24",
        signingKey: Keypair.random().publicKey(),
      },
      "token",
      "withdraw-1",
      (tx) => tx.status === "pending_user_transfer_start",
      { timeoutMs: 0 },
    ),
  ).rejects.toThrow("Withdrawal cannot continue (no_market).");
});

it("does not return a non-matching status when polling times out", async () => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.TESTNET);
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_RPC_URL",
    "https://soroban-testnet.stellar.org",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: { id: "withdraw-2", status: "pending_anchor" },
      }),
    }),
  );
  const { pollSep24Until, Sep24PollTimeoutError } = await import(
    "../src/lib/anchor"
  );
  await expect(
    pollSep24Until(
      {
        homeDomain: "anchor.example",
        webAuthEndpoint: "https://anchor.example/auth",
        transferServer: "https://anchor.example/sep24",
        signingKey: Keypair.random().publicKey(),
      },
      "token",
      "withdraw-2",
      (tx) => tx.status === "pending_user_transfer_complete",
      { timeoutMs: 0 },
    ),
  ).rejects.toBeInstanceOf(Sep24PollTimeoutError);
});
