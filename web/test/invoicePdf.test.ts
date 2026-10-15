// @vitest-environment node

import type { InvoiceContent } from "../src/lib/invoiceCrypto";
import {
  invoiceFileName,
  invoiceModel,
  renderInvoicePdf,
} from "../src/lib/invoicePdf";

const content: InvoiceContent = {
  customer: {
    name: "Nordic Wave AB",
    email: "sofia@nordicwave.se",
    address: "Kungsgatan 8\nStockholm 11143",
  },
  lineItems: [
    { description: "Logo", quantity: 1, unitPrice: "5000000000" },
    { description: "Website design", quantity: 1, unitPrice: "25000000000" },
  ],
  notes: null,
  salt: "00".repeat(32),
};

const invoice = {
  number: 77,
  issuedAt: "2026-05-21T10:00:00.000Z",
  dueAt: "2026-06-20T10:00:00.000Z",
  amountDue: "30000000000",
  paidAmount: "0",
  remainingAmount: "30000000000",
};

const base = {
  invoice,
  content,
  username: "solt",
  businessName: "Solt Wagner Inc",
  payLink: `https://olio.example/pay/solt/inv-0077-abcd#k=${"f".repeat(64)}`,
};

describe("invoice PDF", () => {
  it("renders the reference layout on one page", async () => {
    const doc = await renderInvoicePdf(base);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = doc.output();
    expect(text).toContain("(INVOICE)");
    expect(text).toContain("(INV-0077)");
    expect(text).toContain("(Nordic Wave AB)");
    expect(text).toContain("3,000.00 USDC");
    expect(text).toContain("Thank you for your business.");
  });

  it("shows a short pay link that opens the full link", async () => {
    const model = invoiceModel(base);
    expect(model.payment[1]).toEqual({
      label: "Pay online",
      value: "olio.example/pay/solt/inv-0077-abcd",
      href: base.payLink,
    });
    const text = (await renderInvoicePdf(base)).output();
    expect(text).toContain(`/URI (${base.payLink})`);
  });

  it("names the file after the issue date", () => {
    expect(invoiceFileName(base)).toBe("OlioInvoice-solt-2026-05-21.pdf");
  });

  it("adds paid and balance rows for a partial payment", () => {
    const model = invoiceModel({
      ...base,
      invoice: {
        ...invoice,
        paidAmount: "10000000000",
        remainingAmount: "20000000000",
      },
    });
    expect(model.totals.map((total) => total.label)).toEqual([
      "Subtotal",
      "Total",
      "Paid",
      "Balance due",
    ]);
    expect(model.totals[3].value).toBe("2,000.00 USDC");
  });

  it("shows a draft without an issue date", () => {
    const model = invoiceModel({
      ...base,
      invoice: { ...invoice, issuedAt: null, dueAt: null },
      payLink: null,
    });
    expect(model.dates).toEqual([
      ["Issued", "Draft"],
      ["Due", "On receipt"],
    ]);
    expect(model.payment).toContainEqual({
      label: "Pay to",
      value: "@solt on Olio",
    });
  });

  it("keeps a long invoice to one page", async () => {
    const doc = await renderInvoicePdf({
      ...base,
      content: {
        ...content,
        lineItems: Array.from({ length: 30 }, (_, index) => ({
          description: `Consulting block ${index + 1} `.repeat(6),
          quantity: index + 1,
          unitPrice: "1000000000",
        })),
        notes: "Payment terms apply. ".repeat(60),
      },
    });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output()).toMatch(/\+ \d+ more items/);
  });
});
