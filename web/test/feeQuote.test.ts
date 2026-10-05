import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/lib/crypto";
import {
  authorizationBytes,
  authorizationDigest,
  paymentBindingBytes,
  paymentBindingDigest,
  type SignedFeeQuote,
  signFeeQuote,
  verifyFeeQuoteSignature,
} from "../src/lib/fee-quote";

const filled = (byte: number) => new Uint8Array(32).fill(byte);
const quote: SignedFeeQuote = {
  formatVersion: 1,
  policyVersion: 2,
  quoteId: filled(1),
  networkId: filled(2),
  pool: StrKey.encodeContract(filled(9)),
  depositor: StrKey.encodeContract(filled(8)),
  commitment: filled(3),
  paymentAmount: 10_000_000n,
  feeBps: 200,
  feeAmount: 200_000n,
  totalAmount: 10_200_000n,
  channel: "cctp",
  sourceDomain: 1,
  sourcePayer: filled(4),
  issuedAt: 100n,
  expiresAt: 200n,
};

const PAYMENT_BYTES =
  "0000001000000001000000020000000d000000134f4c494f5f4645455f5041594d454e545f56310000000011000000010000000e0000000f000000076368616e6e656c000000001000000001000000010000000f00000004436374700000000f0000000a636f6d6d69746d656e7400000000000d0000002003030303030303030303030303030303030303030303030303030303030303030000000f000000096465706f7369746f72000000000000120000000108080808080808080808080808080808080808080808080808080808080808080000000f0000000a6665655f616d6f756e7400000000000a00000000000000000000000000030d400000000f000000076665655f6270730000000003000000c80000000f0000000e666f726d61745f76657273696f6e000000000003000000010000000f0000000a6e6574776f726b5f696400000000000d0000002002020202020202020202020202020202020202020202020202020202020202020000000f0000000e7061796d656e745f616d6f756e7400000000000a000000000000000000000000009896800000000f0000000e706f6c6963795f76657273696f6e000000000003000000020000000f00000004706f6f6c000000120000000109090909090909090909090909090909090909090909090909090909090909090000000f0000000871756f74655f69640000000d0000002001010101010101010101010101010101010101010101010101010101010101010000000f0000000d736f757263655f646f6d61696e00000000000003000000010000000f0000000c736f757263655f70617965720000000d0000002004040404040404040404040404040404040404040404040404040404040404040000000f0000000c746f74616c5f616d6f756e740000000a000000000000000000000000009ba3c0";
const AUTH_BYTES =
  "0000001000000001000000040000000d000000104f4c494f5f4645455f415554485f56310000000d000000206448badaa7b0c7283517240bda294c4179c648ba3cf6b471324aff3fc88463fd0000000500000000000000640000000500000000000000c8";

describe("canonical fee quote", () => {
  it("rejects unknown persisted channels instead of encoding them as CCTP", () => {
    expect(() =>
      paymentBindingBytes({
        ...quote,
        channel: "retired" as SignedFeeQuote["channel"],
      }),
    ).toThrow("Unsupported fee channel");
  });
  it("matches the Rust XDR, digests, public key, and Ed25519 signature", () => {
    const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
    expect(bytesToHex(paymentBindingBytes(quote))).toBe(PAYMENT_BYTES);
    expect(bytesToHex(paymentBindingDigest(quote))).toBe(
      "6448badaa7b0c7283517240bda294c4179c648ba3cf6b471324aff3fc88463fd",
    );
    expect(bytesToHex(authorizationBytes(quote))).toBe(AUTH_BYTES);
    expect(bytesToHex(authorizationDigest(quote))).toBe(
      "19f1194b0d81937fb70c7731fe9c4ad299e315bd185d49831e97d4b0dc6c35f1",
    );
    expect(signer.rawPublicKey().toString("hex")).toBe(
      "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c",
    );
    const signature = signFeeQuote(quote, signer);
    expect(bytesToHex(signature)).toBe(
      "c31f7423dedc37908786a672085db08140a87b132c03ca8add66b3ffe4d20d4e082bff03ec4a001eb58cbb046131d88041cd5b75e93bcfb5c8e2387da246590d",
    );
    expect(
      verifyFeeQuoteSignature(quote, signature, signer.rawPublicKey()),
    ).toBe(true);
  });
});

describe("signed quote tamper resistance", () => {
  const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
  const changes: Partial<SignedFeeQuote>[] = [
    { formatVersion: 2 },
    { policyVersion: 3 },
    { quoteId: filled(5) },
    { networkId: filled(5) },
    { pool: StrKey.encodeContract(filled(5)) },
    { depositor: StrKey.encodeContract(filled(5)) },
    { commitment: filled(5) },
    { paymentAmount: 10_000_001n },
    { feeBps: 500 },
    { feeAmount: 500_000n },
    { totalAmount: 10_500_000n },
    { channel: "direct" },
    { sourceDomain: 6 },
    { sourcePayer: filled(5) },
  ];
  it.each(changes)("binds every immutable field: %o", (change) => {
    const altered = { ...quote, ...change };
    expect(paymentBindingDigest(altered)).not.toEqual(
      paymentBindingDigest(quote),
    );
    expect(
      verifyFeeQuoteSignature(
        altered,
        signFeeQuote(quote, signer),
        signer.rawPublicKey(),
      ),
    ).toBe(false);
  });

  it.each([
    { issuedAt: 101n },
    { expiresAt: 201n },
  ])("requires a new signature for renewed authorization: %o", (change) => {
    const renewed = { ...quote, ...change };
    expect(paymentBindingDigest(renewed)).toEqual(paymentBindingDigest(quote));
    expect(
      verifyFeeQuoteSignature(
        renewed,
        signFeeQuote(quote, signer),
        signer.rawPublicKey(),
      ),
    ).toBe(false);
    expect(
      verifyFeeQuoteSignature(
        renewed,
        signFeeQuote(renewed, signer),
        signer.rawPublicKey(),
      ),
    ).toBe(true);
  });

  it("rejects a signature from an unauthorized key and a corrupted signature", () => {
    const signature = signFeeQuote(quote, signer);
    expect(
      verifyFeeQuoteSignature(
        quote,
        signature,
        Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).rawPublicKey(),
      ),
    ).toBe(false);
    signature[0] ^= 1;
    expect(
      verifyFeeQuoteSignature(quote, signature, signer.rawPublicKey()),
    ).toBe(false);
  });
});
