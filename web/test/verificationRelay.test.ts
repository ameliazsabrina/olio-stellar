// @vitest-environment node
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  StrKey,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), wallet: vi.fn() }));
vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireSubmission: mocks.guard,
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: mocks.wallet,
}));
vi.mock("../src/lib/stellar", async () => {
  const { StrKey } = await import("@stellar/stellar-sdk");
  return {
    poolId: StrKey.encodeContract(Buffer.alloc(32, 1)),
    registryId: StrKey.encodeContract(Buffer.alloc(32, 2)),
    usdcSacId: StrKey.encodeContract(Buffer.alloc(32, 3)),
    networkPassphrase: "Test SDF Network ; September 2015",
  };
});
vi.mock("../src/env.server", async () => {
  const { Keypair } = await import("@stellar/stellar-sdk");
  return {
    getServerEnv: () => ({
      FEE_QUOTE_SIGNING_SECRET: Keypair.fromRawEd25519Seed(
        Buffer.alloc(32, 4),
      ).secret(),
    }),
  };
});
import { authorizeRelay } from "../src/server/modules/channels/channels.authorization";
import {
  feeQuoteScVal,
  signFeeQuote,
  stellarNetworkId,
  type SignedFeeQuote,
} from "../src/lib/fee-quote";
const pool = StrKey.encodeContract(Buffer.alloc(32, 1));
const registry = StrKey.encodeContract(Buffer.alloc(32, 2));
const token = StrKey.encodeContract(Buffer.alloc(32, 3));
const account = StrKey.encodeContract(Buffer.alloc(32, 5));
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const payer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6)).publicKey();
const func = (contract: string, method: string, args: any[] = []) =>
  new Contract(contract)
    .call(method, ...args)
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .toXDR("base64");
const addr = (s: string) => new Address(s).toScVal();
const bytes = (b: Uint8Array) => nativeToScVal(Buffer.from(b));
function deposit(
  overrides: Partial<SignedFeeQuote> = {},
  signatureOverride?: Uint8Array,
) {
  const quote: SignedFeeQuote = {
    formatVersion: 1,
    policyVersion: 1,
    quoteId: Buffer.alloc(32, 7),
    networkId: stellarNetworkId("Test SDF Network ; September 2015"),
    pool,
    depositor: payer,
    commitment: Buffer.alloc(32, 8),
    paymentAmount: 10000000n,
    feeBps: 100,
    feeAmount: 100000n,
    totalAmount: 10100000n,
    channel: "direct",
    sourceDomain: 0,
    sourcePayer: Buffer.alloc(32),
    issuedAt: BigInt(Math.floor(Date.now() / 1000)),
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 300),
    ...overrides,
  };
  return func(pool, "deposit", [
    addr(quote.depositor),
    bytes(quote.commitment),
    nativeToScVal(quote.paymentAmount, { type: "i128" }),
    feeQuoteScVal(quote),
    bytes(signatureOverride ?? signFeeQuote(quote, signer)),
    nativeToScVal(null),
    bytes(Buffer.alloc(32)),
    bytes(Buffer.alloc(32)),
  ]);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallet.mockResolvedValue({ contractId: account });
  mocks.guard.mockResolvedValue({ contractId: account });
});
describe("relay contract and operation authorization", () => {
  it("allows registration and recovery without submission, only on the owned account", async () => {
    await authorizeRelay(func(registry, "register", [addr(account)]), "user");
    await authorizeRelay(
      func(account, "set_owner", [bytes(Buffer.alloc(32))]),
      "user",
    );
    expect(mocks.guard).not.toHaveBeenCalled();
    await expect(
      authorizeRelay(func(registry, "register", [addr(pool)]), "user"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeRelay(func(account, "set_owner"), null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("guards account payments and blocks unsupported operations", async () => {
    mocks.guard.mockRejectedValue(new Error("submission required"));
    await expect(
      authorizeRelay(func(pool, "withdraw"), "user"),
    ).rejects.toThrow("submission required");
    await expect(
      authorizeRelay(func(token, "transfer", [addr(account)]), "user"),
    ).rejects.toThrow("submission required");
    await expect(
      authorizeRelay(func(pool, "set_admin"), "user"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeRelay(func(pool, "withdraw"), null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows guest deposits only with a valid, unexpired quote for this network", async () => {
    await expect(authorizeRelay(deposit(), null)).resolves.toBeUndefined();
    await expect(
      authorizeRelay(deposit({}, Buffer.alloc(64)), null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeRelay(deposit({ expiresAt: 1n }), null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeRelay(deposit({ networkId: Buffer.alloc(32) }), null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeRelay(deposit({ depositor: account }), null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
