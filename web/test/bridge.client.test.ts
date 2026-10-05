import { Asset, Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fund: vi.fn(),
  loadAccount: vi.fn(),
  submitTransaction: vi.fn(),
}));

vi.mock("../src/trpc/client", () => ({
  api: { bridge: { fund: { mutate: mocks.fund } } },
}));

vi.mock("../src/lib/stellar-payments", () => ({
  friendbotUrl: "https://friendbot.example",
  horizon: {
    loadAccount: mocks.loadAccount,
    submitTransaction: mocks.submitTransaction,
  },
  offRampAsset: () =>
    new Asset(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    ),
}));

vi.mock("../src/lib/withdraw", () => ({ withdrawNote: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.loadAccount.mockResolvedValue({
    balances: [
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer:
          "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      },
    ],
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses the sponsor API on mainnet", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    "Public Global Stellar Network ; September 2015",
  );
  vi.stubEnv("NEXT_PUBLIC_STELLAR_RPC_URL", "https://rpc.example");
  const { createBridge, provisionBridge } = await import("../src/lib/bridge");
  const bridge = createBridge();

  await provisionBridge(bridge);

  expect(mocks.fund).toHaveBeenCalledWith({
    bridgePublicKey: bridge.publicKey,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps Friendbot funding on testnet", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    "Test SDF Network ; September 2015",
  );
  vi.stubEnv(
    "NEXT_PUBLIC_STELLAR_RPC_URL",
    "https://soroban-testnet.stellar.org",
  );
  const { provisionBridge } = await import("../src/lib/bridge");
  const publicKey = Keypair.random().publicKey();

  await provisionBridge({
    publicKey,
    keypair: Keypair.random(),
  });

  expect(fetch).toHaveBeenCalledWith(
    `https://friendbot.example?addr=${encodeURIComponent(publicKey)}`,
  );
  expect(mocks.fund).not.toHaveBeenCalled();
});
