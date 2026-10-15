import type { jsPDF } from "jspdf";
import {
  compactDay,
  formatPdfDate,
  formatUsdc,
  type PdfArtwork,
  type PdfDocumentModel,
  type PdfPaymentDetail,
  pdfFileName,
  renderDocumentPdf,
} from "./documentPdf";
import { loadPdfArtwork } from "./pdfArtwork";

export type ReceiptSettlement = {
  txHash: string;
  ledgerClosedAt: string;
  invoiceNumber: string | null;
};

export type ReceiptInput = {
  amount: bigint;
  leafIndex: number;
  username: string | null;
  displayName?: string | null;
  settlement?: ReceiptSettlement | null;
  createdAt?: Date;
};

function shortId(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function receiptPaidAt(input: ReceiptInput): Date {
  const settled = input.settlement
    ? new Date(input.settlement.ledgerClosedAt)
    : null;
  return settled && !Number.isNaN(settled.getTime())
    ? settled
    : (input.createdAt ?? new Date());
}

export function receiptNumber(input: ReceiptInput): string {
  const leaf = String(input.leafIndex).padStart(4, "0");
  return `OR-${compactDay(receiptPaidAt(input))}-${leaf}`;
}

export function receiptFileName(input: ReceiptInput): string {
  return pdfFileName("receipt", input.username, receiptPaidAt(input));
}

export function receiptModel(input: ReceiptInput): PdfDocumentModel {
  const amount = formatUsdc(input.amount);
  const handle = input.username ? `@${input.username}` : null;
  const name = input.displayName || handle || "Olio account";
  const invoice = input.settlement?.invoiceNumber ?? null;
  const payment: PdfPaymentDetail[] = [
    { label: "Payment method", value: "USDC (digital US dollars)" },
    { label: "Network", value: "Stellar" },
    { label: "Payment reference", value: `#${input.leafIndex}` },
  ];
  if (input.settlement?.txHash)
    payment.push({
      label: "Transaction ID",
      value: shortId(input.settlement.txHash),
    });
  return {
    kind: "receipt",
    number: receiptNumber(input),
    from: {
      heading: "Received by",
      name,
      lines: [
        ...(handle && name !== handle ? [handle] : []),
        "Paid through Olio (oliopay.xyz",
      ],
    },
    to: null,
    dates: [
      ["Paid", formatPdfDate(receiptPaidAt(input))],
      ["Status", "Paid"],
    ],
    items: [
      {
        description: invoice
          ? `Payment for invoice ${invoice}`
          : "Payment received",
        quantity: "1",
        unitPrice: amount,
        amount,
      },
    ],
    totals: [{ label: "Total paid", value: amount, emphasis: true }],
    payment,
    notes:
      "This receipt records one payment. It does not show any other payments or balances.",
  };
}

export function renderReceiptPdf(
  input: ReceiptInput,
  artwork?: PdfArtwork,
): Promise<jsPDF> {
  return renderDocumentPdf(receiptModel(input), artwork);
}

export async function downloadReceiptPdf(input: ReceiptInput): Promise<void> {
  const doc = await renderReceiptPdf(input, await loadPdfArtwork());
  doc.save(receiptFileName(input));
}
