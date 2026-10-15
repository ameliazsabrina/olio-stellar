// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  receiptFileName,
  receiptModel,
  receiptNumber,
  renderReceiptPdf,
} from "../src/lib/disclosurePdf";
import { formatUsdc, pdfFileName } from "../src/lib/documentPdf";

const settlement = {
  txHash: "ab".repeat(32),
  ledgerClosedAt: "2026-10-14T09:30:00.000Z",
  invoiceNumber: "INV-0003",
};

const input = {
  amount: 125_000_000n,
  leafIndex: 3,
  username: "amelia",
  displayName: "Amelia Studio",
  settlement,
};

const CRYPTO_TERMS = [
  "commitment",
  "Commitment",
  "Merkle",
  "salt",
  "ledger root",
  "pool contract",
  "ownerPk",
  "pathElements",
];

describe("receipt PDF", () => {
  it("renders a single page with the receipt title", async () => {
    const doc = await renderReceiptPdf(input);
    const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
    expect(doc.getNumberOfPages()).toBe(1);
    const text = doc.output();
    expect(text).toContain("(RECEIPT)");
    expect(text).toContain("Payment for invoice INV-0003");
    expect(text).toContain("12.50 USDC");
  });

  it("uses no cryptographic wording", async () => {
    const text = (await renderReceiptPdf(input)).output();
    for (const term of CRYPTO_TERMS) expect(text).not.toContain(term);
  });

  it("dates the receipt by when the payment settled", () => {
    expect(receiptNumber(input)).toBe("OR-20261014-0003");
    expect(receiptFileName(input)).toBe("OlioReceipt-amelia-2026-10-14.pdf");
    expect(receiptModel(input).dates[0]).toEqual(["Paid", "Oct 14, 2026"]);
  });

  it("falls back to the creation date without a settlement", () => {
    const createdAt = new Date(2026, 9, 15, 12);
    const model = receiptModel({
      ...input,
      settlement: null,
      createdAt,
    });
    expect(model.number).toBe("OR-20261015-0003");
    expect(model.items[0].description).toBe("Payment received");
    expect(model.payment.map((detail) => detail.label)).not.toContain(
      "Transaction ID",
    );
  });
});

describe("receipt artwork", () => {
  it("embeds the hands banner and the Olio wordmark", async () => {
    const asset = (name: string) =>
      new Uint8Array(readFileSync(join(__dirname, "../public/assets", name)));
    const doc = await renderReceiptPdf(input, {
      banner: asset("receipt-banner.jpg"),
      logo: asset("receipt-logo.png"),
    });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(
      doc.output().match(/\/Subtype \/Image/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("pdfFileName", () => {
  const date = new Date(2026, 9, 15, 12);

  it("names files by kind, username and day", () => {
    expect(pdfFileName("receipt", "amelia", date)).toBe(
      "OlioReceipt-amelia-2026-10-15.pdf",
    );
    expect(pdfFileName("invoice", "amelia", date)).toBe(
      "OlioInvoice-amelia-2026-10-15.pdf",
    );
  });

  it("drops a missing username and strips unsafe characters", () => {
    expect(pdfFileName("receipt", null, date)).toBe(
      "OlioReceipt-2026-10-15.pdf",
    );
    expect(pdfFileName("receipt", "a/b c..d", date)).toBe(
      "OlioReceipt-abcd-2026-10-15.pdf",
    );
  });
});

describe("formatUsdc", () => {
  it("shows two decimals and groups thousands", () => {
    expect(formatUsdc(125_000_000n)).toBe("12.50 USDC");
    expect(formatUsdc(34_500_000_000n)).toBe("3,450.00 USDC");
    expect(formatUsdc(1_234_567n)).toBe("0.1234567 USDC");
  });
});
