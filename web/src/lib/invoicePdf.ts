import type { jsPDF } from "jspdf";
import {
  formatPdfDate,
  formatUsdc,
  type PdfArtwork,
  type PdfDocumentModel,
  type PdfPaymentDetail,
  pdfFileName,
  renderDocumentPdf,
} from "./documentPdf";
import { type InvoiceContent, invoiceNumberLabel } from "./invoiceCrypto";
import { loadPdfArtwork } from "./pdfArtwork";

export type InvoicePdfInput = {
  invoice: {
    number: number;
    issuedAt: string | null;
    dueAt: string | null;
    amountDue: string;
    paidAmount: string;
    remainingAmount: string;
  };
  content: InvoiceContent;
  username: string | null;
  businessName?: string | null;
  payLink?: string | null;
  createdAt?: Date;
};

function displayLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/#.*$/, "");
}

function invoiceDate(input: InvoicePdfInput): Date {
  const issued = input.invoice.issuedAt
    ? new Date(input.invoice.issuedAt)
    : null;
  return issued && !Number.isNaN(issued.getTime())
    ? issued
    : (input.createdAt ?? new Date());
}

export function invoiceFileName(input: InvoicePdfInput): string {
  return pdfFileName("invoice", input.username, invoiceDate(input));
}

export function invoiceModel(input: InvoicePdfInput): PdfDocumentModel {
  const { invoice, content } = input;
  const handle = input.username ? `@${input.username}` : null;
  const name = input.businessName || handle || "Olio business";
  const amountDue = BigInt(invoice.amountDue);
  const paid = BigInt(invoice.paidAmount);
  const totals: PdfDocumentModel["totals"] = [
    { label: "Subtotal", value: formatUsdc(amountDue) },
    { label: "Total", value: formatUsdc(amountDue), emphasis: true },
  ];
  if (paid > 0n) {
    totals.push(
      { label: "Paid", value: formatUsdc(paid) },
      {
        label: "Balance due",
        value: formatUsdc(BigInt(invoice.remainingAmount)),
        emphasis: true,
      },
    );
  }
  const payment: PdfPaymentDetail[] = [
    { label: "Payment method", value: "USDC through Olio" },
  ];
  if (input.payLink)
    payment.push({
      label: "Pay online",
      value: displayLink(input.payLink),
      href: input.payLink,
    });
  else if (handle)
    payment.push({ label: "Pay to", value: `${handle} on Olio` });
  return {
    kind: "invoice",
    number: invoiceNumberLabel(invoice.number),
    from: {
      heading: "From",
      name,
      lines: handle && name !== handle ? [handle] : [],
    },
    to: {
      heading: "Bill to",
      name: content.customer.name,
      lines: [content.customer.email, content.customer.address].filter(
        (line): line is string => Boolean(line),
      ),
    },
    dates: [
      ["Issued", invoice.issuedAt ? formatPdfDate(invoice.issuedAt) : "Draft"],
      ["Due", invoice.dueAt ? formatPdfDate(invoice.dueAt) : "On receipt"],
    ],
    items: content.lineItems.map((item) => {
      const unit = BigInt(item.unitPrice);
      return {
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: formatUsdc(unit),
        amount: formatUsdc(unit * BigInt(item.quantity)),
      };
    }),
    totals,
    payment,
    notes: content.notes || "Thank you for your business.",
  };
}

export function renderInvoicePdf(
  input: InvoicePdfInput,
  artwork?: PdfArtwork,
): Promise<jsPDF> {
  return renderDocumentPdf(invoiceModel(input), artwork);
}

export async function downloadInvoicePdf(
  input: InvoicePdfInput,
): Promise<void> {
  const doc = await renderInvoicePdf(input, await loadPdfArtwork());
  doc.save(invoiceFileName(input));
}
