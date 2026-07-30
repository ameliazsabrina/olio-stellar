import { Account, Keypair, Networks } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const horizonMock = vi.hoisted(() => ({
  loadAccount: vi.fn(),
  fetchBaseFee: vi.fn(),
  submitTransaction: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn(() => horizonMock),
    },
  };
});

import {
  BridgeConfigError,
  BridgeFundError,
} from "../src/server/modules/bridge/bridge.errors";
import {
  fundBridge,
  validateBridgeFundingAmount,
} from "../src/server/modules/bridge/bridge.service";

const destination = Keypair.random().publicKey();

function horizonError(transaction?: string, operations?: string[]) {
  return {
    response: {
      data: {
        detail: "transaction failed",
        extras: { result_codes: { transaction, operations } },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BRIDGE_SPONSOR_SECRET = Keypair.random().secret();
  horizonMock.fetchBaseFee.mockResolvedValue(100);
  horizonMock.submitTransaction.mockResolvedValue({ hash: "abc123" });
  const sponsor = Keypair.fromSecret(process.env.BRIDGE_SPONSOR_SECRET);
  horizonMock.loadAccount.mockResolvedValue(
    new Account(sponsor.publicKey(), "1"),
  );
});

describe("fundBridge", () => {
  it("validates configured Stellar amounts", () => {
    expect(validateBridgeFundingAmount("2.5")).toBe("2.5");
    expect(() => validateBridgeFundingAmount("0")).toThrow(BridgeConfigError);
    expect(() => validateBridgeFundingAmount("2.12345678")).toThrow(
      BridgeConfigError,
    );
    expect(() => validateBridgeFundingAmount("not-an-amount")).toThrow(
      BridgeConfigError,
    );
  });

  it("builds and signs a createAccount transaction", async () => {
    const result = await fundBridge({ bridgePublicKey: destination });

    expect(result).toEqual({ funded: true, txHash: "abc123" });
    expect(horizonMock.loadAccount).toHaveBeenCalledTimes(1);
    expect(horizonMock.fetchBaseFee).toHaveBeenCalledTimes(1);
    const tx = horizonMock.submitTransaction.mock.calls[0]?.[0];
    expect(tx.networkPassphrase).toBe(Networks.TESTNET);
    expect(tx.operations).toEqual([
      expect.objectContaining({
        type: "createAccount",
        destination,
        startingBalance: "2.5000000",
      }),
    ]);
    expect(tx.signatures).toHaveLength(1);
  });

  it("treats an existing destination as an idempotent success", async () => {
    horizonMock.submitTransaction.mockRejectedValueOnce(
      horizonError("tx_failed", ["op_already_exists"]),
    );

    await expect(fundBridge({ bridgePublicKey: destination })).resolves.toEqual(
      { funded: false, txHash: null },
    );
  });

  it("reloads and retries once after tx_bad_seq", async () => {
    horizonMock.submitTransaction
      .mockRejectedValueOnce(horizonError("tx_bad_seq"))
      .mockResolvedValueOnce({ hash: "retry-hash" });

    await expect(fundBridge({ bridgePublicKey: destination })).resolves.toEqual(
      { funded: true, txHash: "retry-hash" },
    );
    expect(horizonMock.loadAccount).toHaveBeenCalledTimes(2);
    expect(horizonMock.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("maps sponsor exhaustion to a temporary outage", async () => {
    horizonMock.submitTransaction.mockRejectedValueOnce(
      horizonError("tx_failed", ["op_underfunded"]),
    );

    await expect(fundBridge({ bridgePublicKey: destination })).rejects.toEqual(
      new BridgeFundError(
        "Payouts are temporarily unavailable because the funding account needs a refill.",
      ),
    );
  });

  it("rejects missing or malformed sponsor secrets", async () => {
    delete process.env.BRIDGE_SPONSOR_SECRET;
    await expect(fundBridge({ bridgePublicKey: destination })).rejects.toEqual(
      new BridgeConfigError("BRIDGE_SPONSOR_SECRET is not configured."),
    );

    process.env.BRIDGE_SPONSOR_SECRET = "not-a-secret";
    await expect(fundBridge({ bridgePublicKey: destination })).rejects.toEqual(
      new BridgeConfigError("BRIDGE_SPONSOR_SECRET is malformed."),
    );
  });

  it("serializes concurrent submissions and reloads each sequence", async () => {
    let releaseFirst: (() => void) | undefined;
    horizonMock.submitTransaction
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ hash: "first" });
          }),
      )
      .mockResolvedValueOnce({ hash: "second" });

    const first = fundBridge({ bridgePublicKey: destination });
    const second = fundBridge({
      bridgePublicKey: Keypair.random().publicKey(),
    });
    await vi.waitFor(() =>
      expect(horizonMock.submitTransaction).toHaveBeenCalledTimes(1),
    );
    expect(horizonMock.loadAccount).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { funded: true, txHash: "first" },
      { funded: true, txHash: "second" },
    ]);
    expect(horizonMock.loadAccount).toHaveBeenCalledTimes(2);
  });
});
