import { x25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { bytesToHex, R } from "../src/lib/crypto";
import {
  canonicalJson,
  contentCommitment,
  decryptInvoice,
  encryptInvoice,
  type InvoiceContent,
  intentQuoteId,
  invoiceCommitment,
  invoiceNumberLabel,
  invoiceTotal,
  keyFromFragment,
  keyToFragment,
  newInvoiceKey,
  unwrapKey,
  wrapKeyToView,
} from "../src/lib/invoiceCrypto";

const content: InvoiceContent = {
  customer: { name: "Acme Ltd", email: "ap@acme.test", address: null },
  lineItems: [
    { description: "Design sprint", quantity: 2, unitPrice: "1500000000" },
    { description: "Hosting", quantity: 1, unitPrice: "250000000" },
  ],
  notes: "Net 30",
  salt: "ab".repeat(32),
};

const fields = {
  businessId: "biz_12345678",
  invoiceId: "inv_12345678",
  version: 1,
  network: "testnet",
  poolId: "CPOOL",
  asset: "CUSDC",
  amountDue: 3_250_000_000n,
  issuedAt: new Date("2026-10-01T00:00:00Z"),
  dueAt: new Date("2026-10-31T23:59:59Z"),
  contentCommitment: contentCommitment(content),
};

describe("invoice commitments", () => {
  it("serializes canonical JSON independently of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }),
    );
  });

  it("is deterministic and binds every field", () => {
    const first = invoiceCommitment(fields);
    expect(invoiceCommitment({ ...fields })).toBe(first);
    for (const change of [
      { version: 2 },
      { amountDue: 3_250_000_001n },
      { dueAt: null },
      { poolId: "COTHER" },
      { network: "mainnet" },
      { businessId: "biz_other000" },
      { issuedAt: new Date("2026-10-02T00:00:00Z") },
    ]) {
      expect(invoiceCommitment({ ...fields, ...change })).not.toBe(first);
    }
  });

  it("clears the top three bits so the value is a BN254 field element", () => {
    for (let i = 0; i < 20; i += 1) {
      const value = BigInt(
        `0x${invoiceCommitment({ ...fields, version: i + 1 })}`,
      );
      expect(value >> 253n).toBe(0n);
      expect(value < R).toBe(true);
    }
  });

  it("changes the content commitment when content or salt changes", () => {
    const base = contentCommitment(content);
    expect(contentCommitment({ ...content, notes: "Net 15" })).not.toBe(base);
    expect(contentCommitment({ ...content, salt: "cd".repeat(32) })).not.toBe(
      base,
    );
  });

  it("derives the intent quote id from the commitment and nonce", () => {
    const commitment = invoiceCommitment(fields);
    const nonce = new Uint8Array(32).fill(7);
    const quoteId = intentQuoteId(commitment, nonce);
    expect(quoteId).toHaveLength(32);
    expect(bytesToHex(intentQuoteId(commitment, nonce))).toBe(
      bytesToHex(quoteId),
    );
    expect(
      bytesToHex(intentQuoteId(commitment, new Uint8Array(32).fill(8))),
    ).not.toBe(bytesToHex(quoteId));
  });
});

describe("invoice encryption", () => {
  it("round-trips content with the per-invoice key", () => {
    const key = newInvoiceKey();
    const encrypted = encryptInvoice(content, key);
    expect(decryptInvoice(encrypted, key)).toEqual(content);
    expect(() => decryptInvoice(encrypted, newInvoiceKey())).toThrow();
  });

  it("wraps the key to the business view key", () => {
    const viewSk = x25519.utils.randomSecretKey();
    const key = newInvoiceKey();
    const wrapped = wrapKeyToView(key, x25519.getPublicKey(viewSk));
    expect(wrapped).toHaveLength((32 + 24 + 32 + 16) * 2);
    expect(unwrapKey(wrapped, viewSk)).toEqual(key);
    expect(() => unwrapKey(wrapped, x25519.utils.randomSecretKey())).toThrow();
  });

  it("carries the key in the URL fragment only", () => {
    const key = newInvoiceKey();
    const fragment = keyToFragment(key);
    expect(fragment.startsWith("k=")).toBe(true);
    expect(keyFromFragment(`#${fragment}`)).toEqual(key);
    expect(keyFromFragment("#other=1")).toBeNull();
  });

  it("totals line items in base units and labels numbers", () => {
    expect(invoiceTotal(content.lineItems)).toBe(3_250_000_000n);
    expect(invoiceNumberLabel(7)).toBe("INV-0007");
  });
});
