import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { stellarContractToBytes32 } from "@/features/cctpPayer/burn";

// Circle's Stellar CCTP minter interprets the 32-byte mintRecipient as a
// contract-id hash, so the payer must encode the intake *contract* (C…) as its
// raw 32 bytes — not a G-account's ed25519 key. This pins that encoding.
describe("stellarContractToBytes32", () => {
  it("encodes a C-address to its raw 32-byte contract id as 0x hex", () => {
    const raw = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
    const cAddr = StrKey.encodeContract(Buffer.from(raw));

    const hex = stellarContractToBytes32(cAddr);

    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hex.slice(2)).toBe(Buffer.from(raw).toString("hex"));
  });

  it("round-trips: decode(encode(bytes)) === bytes", () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const cAddr = StrKey.encodeContract(Buffer.from(raw));

    const hex = stellarContractToBytes32(cAddr);

    expect(Uint8Array.from(Buffer.from(hex.slice(2), "hex"))).toEqual(raw);
  });
});
