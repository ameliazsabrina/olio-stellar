import { describe, expect, it } from "vitest";
import { isCctpTxHash } from "@/server/modules/cctp/cctp.schema";

// The attestation lookup accepts a chain-shaped source-tx id: an EVM 0x-hash or
// a base58 Solana signature. This pins that both shapes pass and that the S3b
// query-injection surface (path/query metacharacters) stays rejected.
describe("isCctpTxHash", () => {
  it("accepts a 32-byte EVM tx hash", () => {
    expect(isCctpTxHash(`0x${"a".repeat(64)}`)).toBe(true);
    expect(isCctpTxHash(`0x${"0123456789abcdefABCDEF".padEnd(64, "0")}`)).toBe(
      true,
    );
  });

  it("rejects a malformed EVM hash", () => {
    // 0x-prefixed strings can't slip through as base58 either (leading '0').
    expect(isCctpTxHash(`0x${"a".repeat(63)}`)).toBe(false); // too short
    expect(isCctpTxHash(`0x${"a".repeat(65)}`)).toBe(false); // too long
    expect(isCctpTxHash(`0x${"g".repeat(64)}`)).toBe(false); // non-hex
  });

  it("accepts a base58 Solana signature", () => {
    // A realistic 64-byte signature is base58 of length ~87–88.
    const sig = `5j7s6NiJS3JAkvgVoej1aErNCfq4${"z".repeat(60)}`;
    expect(sig.length).toBe(88);
    expect(isCctpTxHash(sig)).toBe(true);
    // Lower bound (43 chars) also acceptable.
    expect(isCctpTxHash("1".repeat(43))).toBe(true);
  });

  it("rejects base58 with excluded characters", () => {
    expect(isCctpTxHash(`0${"1".repeat(87)}`)).toBe(false); // leading 0
    expect(isCctpTxHash(`O${"1".repeat(87)}`)).toBe(false); // O
    expect(isCctpTxHash(`I${"1".repeat(87)}`)).toBe(false); // I
    expect(isCctpTxHash(`l${"1".repeat(87)}`)).toBe(false); // l
  });

  it("rejects injection-shaped and out-of-range input", () => {
    expect(isCctpTxHash("")).toBe(false);
    expect(isCctpTxHash("1".repeat(42))).toBe(false); // below min length
    expect(isCctpTxHash("1".repeat(89))).toBe(false); // above max length
    expect(isCctpTxHash("../../etc/passwd")).toBe(false);
    expect(isCctpTxHash("abc?query=1&x=2")).toBe(false);
    expect(isCctpTxHash("abc%2F..%2F")).toBe(false);
  });
});
