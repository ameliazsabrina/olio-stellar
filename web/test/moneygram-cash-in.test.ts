import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountPubkeys: vi.fn(),
  proveDeposit: vi.fn(),
  scanDeposits: vi.fn(),
  transferUsdc: vi.fn(),
  poolDeposit: vi.fn(),
  usdcBalance: vi.fn(),
}));

vi.mock("../src/lib/notes", () => ({ accountPubkeys: mocks.accountPubkeys }));
vi.mock("../src/lib/prover", () => ({ proveDeposit: mocks.proveDeposit }));
vi.mock("../src/lib/stellar", () => ({
  scanDeposits: mocks.scanDeposits,
  transferUsdc: mocks.transferUsdc,
  poolDeposit: mocks.poolDeposit,
  usdcBalance: mocks.usdcBalance,
}));

import { cashInSalt } from "../src/lib/crypto";
import { shieldVerifiedCashIn } from "../src/lib/moneygram-cash-in";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountPubkeys.mockResolvedValue({
    notePubkey: new Uint8Array(32).fill(1),
    viewPubkey: new Uint8Array(32).fill(2),
  });
});

it("derives a stable domain-separated salt from the settlement identity", () => {
  expect(cashInSalt(42n, "tx:op")).toBe(cashInSalt(42n, "tx:op"));
  expect(cashInSalt(42n, "tx:op")).not.toBe(cashInSalt(42n, "other:op"));
});

it("does not transfer or deposit again when the deterministic commitment exists", async () => {
  // First compute the same commitment by letting the implementation run once far enough.
  mocks.scanDeposits.mockResolvedValueOnce([]);
  mocks.usdcBalance.mockResolvedValue(100n);
  mocks.proveDeposit.mockResolvedValue({
    proof: { a: new Uint8Array(), b: new Uint8Array(), c: new Uint8Array() },
  });
  mocks.poolDeposit.mockResolvedValue({ leafIndex: 7, txHash: "shield-hash" });
  // Use a real first scan result captured from poolDeposit's commitment argument.
  let commitment: Uint8Array | undefined;
  mocks.poolDeposit.mockImplementationOnce(async (_s, note) => {
    commitment = note;
    mocks.scanDeposits.mockResolvedValueOnce([
      { leafIndex: 7, commitment: note },
    ]);
    return { leafIndex: 7, txHash: "shield-hash" };
  });
  const options = {
    account: { ownerSecret: 9n, viewSk: new Uint8Array(32) },
    olioSigner: { address: "COLIO" } as never,
    privyUsdcSigner: { address: "GPRIVY" } as never,
    settlementIdentity: "stellar-hash:operation-1",
    amount: 100n,
  };
  await shieldVerifiedCashIn(options);
  mocks.scanDeposits.mockResolvedValueOnce([{ leafIndex: 7, commitment }]);
  const retried = await shieldVerifiedCashIn(options);
  expect(retried.alreadyShielded).toBe(true);
  expect(mocks.poolDeposit).toHaveBeenCalledOnce();
  expect(mocks.transferUsdc).toHaveBeenCalledOnce();
});
