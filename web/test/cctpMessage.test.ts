import { describe, expect, it } from "vitest";
import { cctpBinding } from "@/lib/cctp";
import { parseCctpMessage } from "@/lib/cctpMessage";

// Build a CCTP V2 message by writing each field at its ABSOLUTE offset, written
// out as literals here (not imported from the parser) so this test independently
// pins the byte layout the parser must agree with.
function buildMessage(opts: {
  sourceDomain: number;
  mintRecipient: Uint8Array; // 32B
  amount: bigint; // canonical 6-dec, written as u256 BE @216
  hookData: Uint8Array;
}): string {
  const bytes = new Uint8Array(376 + opts.hookData.length);
  // sourceDomain u32 @4
  const sd = opts.sourceDomain >>> 0;
  bytes[4] = (sd >>> 24) & 0xff;
  bytes[5] = (sd >>> 16) & 0xff;
  bytes[6] = (sd >>> 8) & 0xff;
  bytes[7] = sd & 0xff;
  // mintRecipient 32B @184
  bytes.set(opts.mintRecipient, 184);
  // amount u256 BE @216 (write into the low bytes of the 32B slot)
  let v = opts.amount;
  for (let i = 247; i >= 216; i -= 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  // hookData @376
  bytes.set(opts.hookData, 376);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const filled = (n: number, byte: number) => new Uint8Array(n).fill(byte);

describe("parseCctpMessage", () => {
  it("reads mintRecipient, amount, and hookData at the V2 offsets", () => {
    const mintRecipient = filled(32, 0xab);
    const hookData = filled(32, 0xcd);
    const hex = buildMessage({
      sourceDomain: 6,
      mintRecipient,
      amount: 5_000000n, // 5 USDC canonical (6-dec)
      hookData,
    });

    const msg = parseCctpMessage(hex);
    expect(msg.sourceDomain).toBe(6);
    expect([...msg.mintRecipient]).toEqual([...mintRecipient]);
    expect(msg.amount).toBe(5_000000n);
    expect([...msg.hookData]).toEqual([...hookData]);
    // canonical 6-dec → Stellar 7-dec is ×10: 5 USDC = 50_000000 stroops.
    expect(msg.amount * 10n).toBe(50_000000n);
  });

  it("parses hex with or without a 0x prefix", () => {
    const hex = buildMessage({
      sourceDomain: 0,
      mintRecipient: filled(32, 1),
      amount: 1n,
      hookData: filled(32, 2),
    });
    expect(parseCctpMessage(hex).amount).toBe(
      parseCctpMessage(hex.slice(2)).amount,
    );
  });

  it("rejects a message shorter than a V2 burn message", () => {
    expect(() => parseCctpMessage(`0x${"00".repeat(200)}`)).toThrow();
  });

  it("rejects non-hex input", () => {
    expect(() => parseCctpMessage("0xnothex")).toThrow();
  });
});

describe("cctpBinding parity (client burn ↔ server relay check)", () => {
  it("recomputes the same commitment the parser reads from hookData", () => {
    // The payer's burn.ts sets hookData = cctpBinding(notePubkey, nonce); the
    // relay recomputes it from the resolved payee. This asserts both sides agree.
    const notePubkey = filled(32, 0x11);
    const nonce = filled(32, 0x22);
    const hookData = cctpBinding(notePubkey, nonce);

    const hex = buildMessage({
      sourceDomain: 1,
      mintRecipient: filled(32, 0),
      amount: 1_000000n,
      hookData,
    });

    const parsed = parseCctpMessage(hex);
    expect([...parsed.hookData]).toEqual([...cctpBinding(notePubkey, nonce)]);
  });

  it("changes if the payee note key or nonce changes (second preimage)", () => {
    const base = cctpBinding(filled(32, 0x11), filled(32, 0x22));
    const otherPayee = cctpBinding(filled(32, 0x33), filled(32, 0x22));
    const otherNonce = cctpBinding(filled(32, 0x11), filled(32, 0x44));
    expect([...otherPayee]).not.toEqual([...base]);
    expect([...otherNonce]).not.toEqual([...base]);
  });
});
