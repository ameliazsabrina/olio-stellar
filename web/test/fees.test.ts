import { describe, expect, it } from "vitest";
import {
  assertCctpQuoteRepresentable,
  isCctpRepresentable,
  MAX_NOTE_AMOUNT,
  quoteOlioFee,
} from "../src/lib/fees";

describe("Olio fee quote", () => {
  it.each([
    [1n, 200, 0n, 1n],
    [49n, 200, 0n, 49n],
    [50n, 200, 1n, 51n],
    [10_000_000n, 200, 200_000n, 10_200_000n],
    [1_000_000_000n, 200, 20_000_000n, 1_020_000_000n],
  ] as const)("quotes %s base units at %s bps", (principal, bps, fee, total) => {
    expect(quoteOlioFee(principal, bps)).toMatchObject({
      paymentAmount: principal,
      feeBps: bps,
      feeAmount: fee,
      totalAmount: total,
      policyVersion: 2,
    });
  });

  it("rejects the retired 5% tier", () => {
    expect(() => quoteOlioFee(1_000_000_000n, 500 as never)).toThrow(RangeError);
  });

  it("rejects invalid principals", () => {
    expect(() => quoteOlioFee(0n, 200)).toThrow(RangeError);
    expect(() => quoteOlioFee(-1n, 200)).toThrow(RangeError);
    expect(() => quoteOlioFee(MAX_NOTE_AMOUNT + 1n, 200)).toThrow(RangeError);
  });

  it("requires both CCTP principal and total to map exactly to 6 decimals", () => {
    expect(isCctpRepresentable(10_000_000n)).toBe(true);
    expect(isCctpRepresentable(10_000_001n)).toBe(false);
    expect(() =>
      assertCctpQuoteRepresentable(quoteOlioFee(10_000_000n, 200)),
    ).not.toThrow();
    expect(() => assertCctpQuoteRepresentable(quoteOlioFee(50n, 200))).toThrow(
      /cross-chain exactly/,
    );
  });
});
