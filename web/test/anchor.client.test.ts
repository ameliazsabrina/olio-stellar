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

it("posts the SEP-24 deposit payload and parses its interactive response", async () => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.TESTNET);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "deposit-15",
      url: "https://anchor.example/deposit/15",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://olio.example" } });
  const { startInteractiveDeposit } = await import("../src/lib/anchor");
  const info = {
    homeDomain: "anchor.example",
    webAuthEndpoint: "https://anchor.example/auth",
    transferServer: "https://anchor.example/sep24",
    signingKey: Keypair.random().publicKey(),
  };

  await expect(
    startInteractiveDeposit(info, "token", "GDESTINATION", "15"),
  ).resolves.toEqual({
    id: "deposit-15",
    url: "https://anchor.example/deposit/15",
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://anchor.example/sep24/transactions/deposit/interactive",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
      body: JSON.stringify({
        asset_code: "USDC",
        account: "GDESTINATION",
        amount: "15",
        lang: "en",
        wallet_name: "Olio",
        wallet_url: "https://olio.example",
      }),
    }),
  );
});

it("treats refunded as a successful poll outcome and retains refund details", async () => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.TESTNET);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: {
          id: "refund-1",
          kind: "withdrawal",
          status: "refunded",
          refunds: {
            amount_refunded: "15",
            payments: [{ id: "repayment-1", amount: "15" }],
          },
        },
      }),
    }),
  );
  const { pollSep24Until } = await import("../src/lib/anchor");
  const tx = await pollSep24Until(
    {
      homeDomain: "anchor.example",
      webAuthEndpoint: "https://anchor.example/auth",
      transferServer: "https://anchor.example/sep24",
      signingKey: Keypair.random().publicKey(),
    },
    "token",
    "refund-1",
    (value) => value.status === "refunded",
    { timeoutMs: 0 },
  );
  expect(tx.refunds?.payments?.[0]?.id).toBe("repayment-1");
});

it("accepts COMMIT_RESULT only from the anchor origin for the expected transaction", async () => {
  const { isTrustedCommitResult } = await import("../src/lib/anchor");
  const info = {
    homeDomain: "anchor.example",
    webAuthEndpoint: "https://anchor.example/auth",
    transferServer: "https://anchor.example/sep24",
    signingKey: Keypair.random().publicKey(),
  };
  const data = {
    type: "COMMIT_RESULT",
    payload: {
      transaction: { id: "deposit-1", status: "pending_user_transfer_start" },
    },
  };
  expect(
    isTrustedCommitResult(
      { origin: "https://anchor.example", data } as MessageEvent,
      info,
      "deposit-1",
    ),
  ).toBe(true);
  expect(
    isTrustedCommitResult(
      { origin: "https://evil.example", data } as MessageEvent,
      info,
      "deposit-1",
    ),
  ).toBe(false);
  expect(
    isTrustedCommitResult(
      { origin: "https://anchor.example", data } as MessageEvent,
      info,
      "other",
    ),
  ).toBe(false);
});

it("rejects SEP-1 metadata whose endpoints point at another domain", async () => {
  vi.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({
    NETWORK_PASSPHRASE: Networks.TESTNET,
    SIGNING_KEY: Keypair.random().publicKey(),
    WEB_AUTH_ENDPOINT: "https://evil.example/auth",
    TRANSFER_SERVER_SEP0024: "https://anchor.example/sep24",
    CURRENCIES: [{ code: "USDC", issuer: "issuer", status: "test" }],
  });
  vi.stubEnv("NEXT_PUBLIC_USDC_ISSUER", "issuer");
  const { fetchAnchorInfo } = await import("../src/lib/anchor");
  await expect(fetchAnchorInfo("https://anchor.example")).rejects.toThrow(
    "mismatched domain",
  );
});

it("fails preflight when the client domain has no signing key", async () => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.TESTNET);
  vi.stubEnv("NEXT_PUBLIC_SEP24_ANCHOR_URL", "https://anchor.example");
  vi.stubEnv("NEXT_PUBLIC_SEP10_CLIENT_DOMAIN", "olio.example");
  vi.stubEnv("NEXT_PUBLIC_USDC_ISSUER", "issuer");
  vi.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({
    NETWORK_PASSPHRASE: Networks.TESTNET,
  });
  const { validateAnchorPreflight } = await import("../src/lib/anchor");
  await expect(validateAnchorPreflight()).rejects.toThrow(
    "client domain does not advertise a signing key",
  );
});
