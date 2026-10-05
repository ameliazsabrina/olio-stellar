import { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  missingTransactionProvenExpired,
  burnWasAuthorized,
  PREPARED_TX_STALE_MS,
  preparedTransactionResolution,
} from "../src/server/modules/cctp/cctpRecovery";

describe("CCTP relay recovery", () => {
  it("preserves a missing checkpoint even after its presumed validity window", () => {
    const now = Date.now();
    expect(
      preparedTransactionResolution(
        rpc.Api.GetTransactionStatus.NOT_FOUND,
        new Date(now - PREPARED_TX_STALE_MS - 1),
        now,
      ),
    ).toBe("pending");
    expect(
      preparedTransactionResolution(
        rpc.Api.GetTransactionStatus.NOT_FOUND,
        new Date(now - 1_000),
        now,
      ),
    ).toBe("pending");
  });

  it("distinguishes confirmed success and failure", () => {
    expect(
      preparedTransactionResolution(rpc.Api.GetTransactionStatus.SUCCESS),
    ).toBe("success");
    expect(
      preparedTransactionResolution(rpc.Api.GetTransactionStatus.FAILED),
    ).toBe("failed");
  });

  it("allows recovery only when the burn occurred within the quote window", () => {
    expect(burnWasAuthorized(100, 100n)).toBe(true);
    expect(burnWasAuthorized(101, 100n)).toBe(false);
    expect(burnWasAuthorized(Number.NaN, 100n)).toBe(false);
  });
});

it("requires actual signed bounds and full RPC ledger coverage before treating NOT_FOUND as non-execution", () => {
  const response = { status: rpc.Api.GetTransactionStatus.NOT_FOUND, oldestLedgerCloseTime: 99, latestLedgerCloseTime: 201 };
  expect(missingTransactionProvenExpired(response, { minTime: 100, maxTime: 200 })).toBe(true);
  expect(missingTransactionProvenExpired(response)).toBe(false);
  expect(missingTransactionProvenExpired({ ...response, oldestLedgerCloseTime: 101 }, { minTime: 100, maxTime: 200 })).toBe(false);
  expect(missingTransactionProvenExpired({ ...response, latestLedgerCloseTime: 200 }, { minTime: 100, maxTime: 200 })).toBe(false);
});
