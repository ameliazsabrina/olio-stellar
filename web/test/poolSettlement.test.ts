// @vitest-environment node
import { Keypair, rpc, StrKey, xdr } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  assembleTransaction: vi.fn(),
}));

vi.mock("../src/lib/stellar", () => ({
  networkPassphrase: "Test SDF Network ; September 2015",
  server: {
    getAccount: mocks.getAccount,
    simulateTransaction: mocks.simulateTransaction,
    sendTransaction: mocks.sendTransaction,
    getTransaction: mocks.getTransaction,
  },
}));
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      assembleTransaction: (
        ...args: Parameters<typeof actual.rpc.assembleTransaction>
      ) =>
        mocks.assembleTransaction(...args) ??
        actual.rpc.assembleTransaction(...args),
    },
  };
});

import { Account, type TransactionBuilder } from "@stellar/stellar-sdk";
import type { SignedFeeQuote } from "../src/lib/fee-quote";
import {
  depositArgs,
  invokeAsSource,
  leafIndexFrom,
  type SettlementDeps,
  scBytesHex,
  settlementKeypair,
} from "../src/server/lib/poolSettlement";

const kp = Keypair.random();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));

function deps(
  lock: {
    assert: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  } | null,
) {
  const claimLock = vi.fn(async () => lock);
  const settlement: SettlementDeps = {
    claimLock,
    lockKey: (publicKey) => `lock:${publicKey}`,
    relayError: (message) => new Error(`relay:${message}`),
    busyError: () => new Error("busy"),
  };
  return { settlement, claimLock };
}

const lock = () => ({
  assert: vi.fn(async () => {}),
  release: vi.fn(async () => {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccount.mockResolvedValue(new Account(kp.publicKey(), "1"));
  mocks.simulateTransaction.mockResolvedValue({
    minResourceFee: "100",
    transactionData: null,
  });
  mocks.assembleTransaction.mockImplementation((tx: TransactionBuilder) => ({
    build: () => tx,
  }));
  mocks.sendTransaction.mockResolvedValue({
    status: "PENDING",
    hash: "ab".repeat(32),
  });
  mocks.getTransaction.mockResolvedValue({
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    returnValue: xdr.ScVal.scvU32(9),
  });
});

describe("settlementKeypair", () => {
  it("throws the configured error when the secret is missing or invalid", () => {
    expect(() =>
      settlementKeypair(undefined, () => new Error("missing")),
    ).toThrow("missing");
    expect(() =>
      settlementKeypair(
        "not-a-secret",
        () => new Error("missing"),
        () => new Error("invalid"),
      ),
    ).toThrow("invalid");
    expect(
      settlementKeypair(kp.secret(), () => new Error("missing")).publicKey(),
    ).toBe(kp.publicKey());
  });
});

describe("invokeAsSource", () => {
  it("refuses to submit when the sequence lock is held elsewhere", async () => {
    const { settlement, claimLock } = deps(null);
    await expect(
      invokeAsSource(settlement, kp, contract, "deposit", []),
    ).rejects.toThrow("busy");
    expect(claimLock).toHaveBeenCalledWith(`lock:${kp.publicKey()}`, 180_000);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("checkpoints the prepared hash and timebounds before submission and releases only after confirmation", async () => {
    const held = lock();
    const { settlement } = deps(held);
    const order: string[] = [];
    held.assert.mockImplementation(async () => {
      order.push("assert");
    });
    mocks.sendTransaction.mockImplementation(async () => {
      order.push("send");
      return { status: "PENDING", hash: "cd".repeat(32) };
    });
    const onPrepared = vi.fn(
      async (hash: string, bounds: { minTime: number; maxTime: number }) => {
        order.push("prepared");
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(bounds.maxTime - bounds.minTime).toBe(180);
      },
    );
    const result = await invokeAsSource(
      settlement,
      kp,
      contract,
      "deposit",
      [],
      onPrepared,
    );
    expect(result).toEqual({ value: 9, txHash: "cd".repeat(32) });
    expect(order).toEqual(["prepared", "assert", "send"]);
    expect(held.assert).toHaveBeenCalledWith(130_000);
    expect(held.release).toHaveBeenCalledTimes(1);
  });

  it("keeps the lease when a submission outcome is ambiguous", async () => {
    const held = lock();
    const { settlement } = deps(held);
    mocks.getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    });
    await expect(
      invokeAsSource(settlement, kp, contract, "deposit", []),
    ).rejects.toThrow("relay:transaction FAILED");
    expect(held.release).not.toHaveBeenCalled();
  });

  it("maps simulation and submission errors through the caller's error factory", async () => {
    const { settlement } = deps(lock());
    mocks.simulateTransaction.mockResolvedValueOnce({
      error: "boom",
      events: [],
    });
    await expect(
      invokeAsSource(settlement, kp, contract, "deposit", []),
    ).rejects.toThrow("relay:boom");
    mocks.sendTransaction.mockResolvedValueOnce({
      status: "ERROR",
      hash: "",
      errorResult: { code: 1 },
    });
    await expect(
      invokeAsSource(settlement, kp, contract, "deposit", []),
    ).rejects.toThrow("relay:submit failed");
  });
});

describe("deposit helpers", () => {
  it("encodes the pool deposit argument list in contract order", () => {
    const quote: SignedFeeQuote = {
      formatVersion: 1,
      policyVersion: 2,
      quoteId: new Uint8Array(32),
      networkId: new Uint8Array(32),
      pool: contract,
      depositor: kp.publicKey(),
      commitment: new Uint8Array(32),
      paymentAmount: 100n,
      feeBps: 200,
      feeAmount: 2n,
      totalAmount: 102n,
      channel: "direct",
      sourceDomain: 0,
      sourcePayer: new Uint8Array(32),
      issuedAt: 0n,
      expiresAt: 1n,
    };
    const args = depositArgs(
      { commitment: new Uint8Array(32).fill(5), amount: 100n },
      quote,
      new Uint8Array(64),
      {
        proof: {
          a: new Uint8Array(64),
          b: new Uint8Array(128),
          c: new Uint8Array(64),
        },
        ephemeralPk: new Uint8Array(32),
        ciphertext: new Uint8Array(48),
      },
    );
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvBytes",
      "scvI128",
      "scvMap",
      "scvBytes",
      "scvMap",
      "scvBytes",
      "scvBytes",
    ]);
  });

  it("validates leaf indexes and strips 0x from hex bytes", () => {
    const { settlement } = deps(lock());
    expect(leafIndexFrom(settlement, 4)).toBe(4);
    expect(leafIndexFrom(settlement, 4n)).toBe(4);
    expect(() => leafIndexFrom(settlement, -1)).toThrow("leaf index");
    expect(() => leafIndexFrom(settlement, "x")).toThrow("leaf index");
    expect(scBytesHex("0xabcd").bytes()).toEqual(Buffer.from("abcd", "hex"));
    expect(scBytesHex("abcd").bytes()).toEqual(Buffer.from("abcd", "hex"));
  });
});
