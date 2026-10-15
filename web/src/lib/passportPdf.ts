import type { jsPDF } from "jspdf";
import type {
  PassportStatement,
  StatementRow,
} from "../server/modules/passport/passport.schema";
import {
  clampLines,
  DOCUMENT_PDF_PALETTE,
  drawBadge,
  fitLine,
  formatUsdc,
  isoDay,
  label,
  mixHex,
  type PdfArtwork,
} from "./documentPdf";
import { loadPdfArtwork } from "./pdfArtwork";

export type PassportPdfInput = {
  statement: PassportStatement;
  digest: string;
  verifyUrl: string;
  username: string | null | undefined;
  /** PNG data URL of the verify QR code; the link alone is printed without it. */
  qr?: string | null;
  txUrl?: (txHash: string) => string;
};

type Cell = { text: string; href?: string; bold?: boolean; muted?: boolean };
type Column = { label: string; width: number; align?: "right" };

const INK = DOCUMENT_PDF_PALETTE.ink;
const MUTED = mixHex(INK, DOCUMENT_PDF_PALETTE.card, 0.55);
const FAINT = mixHex(INK, DOCUMENT_PDF_PALETTE.card, 0.42);
const RULE = mixHex(INK, DOCUMENT_PDF_PALETTE.card, 0.14);

const CARD_INSET = 24;
const PAD = 28;
const FOOTER_HEIGHT = 30;
const ROW_HEIGHT = 16;
const PAYER_ROW_HEIGHT = 28;
const QR_SIZE = 82;
const LINE = 12.5;

const DETAIL_LABEL: Record<PassportStatement["detail"], string> = {
  summary: "Monthly summary",
  full: "Full payment list",
};
const RAIL_LABEL: Record<StatementRow["rail"], string> = {
  direct: "Stellar",
  cctp: "CCTP",
  fiat: "Fiat",
};
const EVIDENCE_LABEL: Record<StatementRow["evidenceLevel"], string> = {
  intent_bound: "Invoice-bound",
  attributed: "Attributed",
  historical_claim: "Claimed",
  unattributed: "Unattributed",
};

function utcDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function utcDateTime(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function amount(units: string): string {
  return formatUsdc(BigInt(units)).replace(" USDC", "");
}

function shortHash(hash: string, keep = 8): string {
  return hash.length > keep * 2
    ? `${hash.slice(0, keep)}…${hash.slice(-keep)}`
    : hash;
}

function invoiceLabel(numbers: number[]): string {
  if (numbers.length === 0) return "—";
  const first = `INV-${String(numbers[0]).padStart(4, "0")}`;
  return numbers.length === 1 ? first : `${first} +${numbers.length - 1}`;
}

export function passportFileName(
  username: string | null | undefined,
  date: Date,
): string {
  const safeName = (username ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return `${["OlioStatement", safeName, isoDay(date)].filter(Boolean).join("-")}.pdf`;
}

function paymentColumns(payerMask: PassportStatement["payerMask"]): Column[] {
  const maskedPayer = payerMask === "masked";
  return [
    { label: "Date", width: 64 },
    { label: "Rail", width: 44 },
    { label: "Invoice", width: maskedPayer ? 58 : 82 },
    { label: "Evidence", width: maskedPayer ? 66 : 98 },
    ...(maskedPayer ? [{ label: "Payer", width: 66 }] : []),
    { label: "Transaction", width: 79 },
    { label: "Refunded", width: 50, align: "right" as const },
    { label: "Amount", width: 64, align: "right" as const },
  ];
}

export async function renderPassportPdf(
  input: PassportPdfInput,
  artwork: PdfArtwork = { banner: null, logo: null },
): Promise<jsPDF> {
  const { statement } = input;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = CARD_INSET + PAD;
  const right = pageWidth - CARD_INSET - PAD;
  const width = right - left;
  const top = CARD_INSET + PAD;
  const contentBottom = pageHeight - CARD_INSET - PAD - FOOTER_HEIGHT;
  const businessName = statement.business.displayName ?? "Unnamed business";

  doc.setProperties({
    title: `Olio Payment Statement ${statement.statementId}`,
    subject: "Track Record payment statement",
    author: "Olio",
    creator: "Olio",
  });

  const drawCard = () => {
    doc.setFillColor(DOCUMENT_PDF_PALETTE.canvas);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(DOCUMENT_PDF_PALETTE.card);
    doc.roundedRect(
      CARD_INSET,
      CARD_INSET,
      pageWidth - CARD_INSET * 2,
      pageHeight - CARD_INSET * 2,
      18,
      18,
      "F",
    );
  };

  let y = top;
  const newPage = () => {
    doc.addPage();
    drawCard();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(INK);
    doc.text("Olio Payment Statement", left, top + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(MUTED);
    doc.text(fitLine(doc, businessName, width / 2), right, top + 4, {
      align: "right",
    });
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.6);
    doc.line(left, top + 14, right, top + 14);
    y = top + 40;
  };
  const ensure = (height: number) => {
    if (y + height > contentBottom) newPage();
  };

  const heading = (text: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(INK);
    doc.text(text, left, y);
    y += 22;
  };

  const drawTable = (
    title: string,
    columns: Column[],
    rows: { cells: Cell[]; note?: Cell }[],
    empty: string,
  ) => {
    // The last column absorbs any slack so right-aligned amounts end flush.
    const sized = columns.map((column, index) =>
      index === columns.length - 1
        ? {
            ...column,
            width:
              width - columns.slice(0, -1).reduce((sum, c) => sum + c.width, 0),
          }
        : column,
    );
    const xs: number[] = [];
    sized.reduce((x, column) => {
      xs.push(column.align === "right" ? x + column.width : x);
      return x + column.width;
    }, left);
    const header = () => {
      sized.forEach((column, index) => {
        label(doc, column.label, xs[index], y, column.align);
      });
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.6);
      doc.line(left, y + 7, right, y + 7);
      y += 7;
    };
    ensure(22 + 7 + ROW_HEIGHT);
    heading(title);
    header();
    if (rows.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(MUTED);
      doc.text(empty, left, y + 15);
      y += ROW_HEIGHT + 10;
      return;
    }
    for (const row of rows) {
      const rowHeight = row.note ? PAYER_ROW_HEIGHT : ROW_HEIGHT;
      if (y + rowHeight > contentBottom) {
        newPage();
        heading(`${title} (continued)`);
        header();
      }
      const baseline = y + 11.5;
      row.cells.forEach((cell, index) => {
        const column = sized[index];
        doc.setFont("helvetica", cell.bold ? "bold" : "normal");
        doc.setFontSize(8);
        doc.setTextColor(cell.muted ? MUTED : INK);
        const text = fitLine(doc, cell.text, column.width - 6);
        doc.text(text, xs[index], baseline, {
          align: column.align,
        });
        if (cell.href) {
          const textWidth = doc.getTextWidth(text);
          const x =
            column.align === "right" ? xs[index] - textWidth : xs[index];
          doc.setDrawColor(MUTED);
          doc.setLineWidth(0.3);
          doc.line(x, baseline + 1.5, x + textWidth, baseline + 1.5);
          doc.link(x, baseline - 8, textWidth, 11, { url: cell.href });
        }
      });
      if (row.note) {
        doc.setFont("courier", "normal");
        doc.setFontSize(7);
        doc.setTextColor(MUTED);
        doc.text(fitLine(doc, row.note.text, width), left, baseline + 10);
      }
      y += rowHeight;
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.4);
      doc.line(left, y, right, y);
    }
    y += 26;
  };

  // Page 1: identity, period, totals.
  drawCard();
  const badgeY = top + 22;
  drawBadge(doc, artwork.logo, left + 22, badgeY);
  label(doc, "Statement", right, badgeY - 6, "right");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(INK);
  doc.text(statement.statementId, right, badgeY + 8, { align: "right" });

  doc.setFontSize(44);
  doc.text("TRACK RECORD", left - 2, badgeY + 76);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(
    `Payment statement · ${DETAIL_LABEL[statement.detail]}`,
    left,
    badgeY + 96,
  );

  const columnsY = badgeY + 132;
  const identityWidth = 190;
  label(doc, "Business", left, columnsY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(INK);
  doc.text(fitLine(doc, businessName, identityWidth), left, columnsY + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  const subject =
    statement.business.type === "company" ? "Company" : "Individual";
  [
    `${subject} · Identity Verified`,
    `Last checked ${utcDate(statement.business.checkedAt)}`,
    `Valid until ${utcDate(statement.business.validUntil)}`,
  ].forEach((line, index) => {
    doc.text(line, left, columnsY + 31 + index * LINE);
  });

  const periodX = left + identityWidth + 20;
  const periodWidth = right - QR_SIZE - 20 - periodX;
  const periodRows: [string, string][] = [
    [
      "Period (UTC)",
      `${utcDate(statement.period.from)} – ${utcDate(statement.period.to)}`,
    ],
    ["Issued", utcDate(statement.issuedAt)],
    ["Statement valid until", utcDate(statement.expiresAt)],
  ];
  periodRows.forEach(([key, value], index) => {
    const rowY = columnsY + index * 26;
    label(doc, key, periodX, rowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK);
    doc.text(fitLine(doc, value, periodWidth), periodX, rowY + 12);
  });

  const qrX = right - QR_SIZE;
  const qrY = columnsY - 8;
  if (input.qr) {
    doc.addImage(input.qr, "PNG", qrX, qrY, QR_SIZE, QR_SIZE);
  } else {
    doc.setFillColor(DOCUMENT_PDF_PALETTE.band);
    doc.roundedRect(qrX, qrY, QR_SIZE, QR_SIZE, 8, 8, "F");
  }
  doc.link(qrX, qrY, QR_SIZE, QR_SIZE, { url: input.verifyUrl });
  label(doc, "Scan to verify", right, qrY + QR_SIZE + 12, "right");

  y = columnsY + 92;
  const gap = 10;
  const boxWidth = (width - gap * 2) / 3;
  const stats: [string, string][] = [
    ["Total received", formatUsdc(BigInt(statement.summary.totalReceived))],
    ["Payments", String(statement.summary.paymentCount)],
    ["Distinct payers", String(statement.summary.distinctPayers)],
  ];
  stats.forEach(([key, value], index) => {
    const x = left + index * (boxWidth + gap);
    doc.setFillColor(DOCUMENT_PDF_PALETTE.band);
    doc.roundedRect(x, y, boxWidth, 50, 10, 10, "F");
    label(doc, key, x + 14, y + 19);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(INK);
    doc.text(fitLine(doc, value, boxWidth - 28), x + 14, y + 37);
  });
  y += 50 + 18;

  const excluded = statement.summary.excludedCount;
  const countNote =
    excluded === 0
      ? "Totals count payments from other people, net of refunds."
      : `Totals count payments from other people, net of refunds. ${excluded} ${
          excluded === 1
            ? "payment was left out because it was"
            : "payments were left out because they were"
        } self-funded or fully refunded.`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  for (const line of clampLines(doc, countNote, width, 3)) {
    doc.text(line, left, y);
    y += LINE;
  }
  y += 18;

  drawTable(
    "Monthly totals",
    [
      { label: "Month", width: 250 },
      { label: "Payments", width: 90, align: "right" },
      { label: "Amount (USDC)", width: width - 340, align: "right" },
    ],
    statement.months.map((month) => ({
      cells: [
        { text: monthLabel(month.month) },
        { text: String(month.count), muted: month.count === 0 },
        { text: amount(month.amount), bold: month.count > 0 },
      ],
    })),
    "No months in this period.",
  );

  if (statement.rows) {
    const payerMask = statement.payerMask;
    drawTable(
      "Payments",
      paymentColumns(payerMask),
      statement.rows.map((row) => ({
        cells: [
          { text: utcDate(row.date) },
          { text: RAIL_LABEL[row.rail], muted: true },
          {
            text: invoiceLabel(row.invoices),
            muted: row.invoices.length === 0,
          },
          { text: EVIDENCE_LABEL[row.evidenceLevel], muted: true },
          ...(payerMask === "masked"
            ? [{ text: row.payer ?? "—", muted: true }]
            : []),
          {
            text: shortHash(row.txHash, 6),
            href: input.txUrl?.(row.txHash),
            muted: !input.txUrl,
          },
          {
            text: row.refunded === "0" ? "—" : amount(row.refunded),
            muted: true,
          },
          { text: amount(row.amount), bold: true },
        ],
        note:
          payerMask === "full"
            ? { text: `Payer ${row.payer ?? "unknown"}` }
            : undefined,
      })),
      "No counted payments in this period.",
    );
  }

  const about = [
    `Olio issued this statement from its settlement ledger, which is built only from deposits indexed on the Stellar network. Payment records were complete as of ${utcDateTime(statement.recordsAsOf)}. The identity section matches the business's Olio identity check. It does not rate revenue, customers or creditworthiness.`,
    `To check it, scan the code or open the verify link. The page must show this statement as valid, with the SHA-256 digest ${input.digest}.`,
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const aboutLines = about.map((text) => clampLines(doc, text, width, 6));
  ensure(22 + aboutLines.flat().length * LINE + 8);
  heading("About this statement");
  for (const lines of aboutLines) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    for (const line of lines) {
      doc.text(line, left, y);
      y += LINE;
    }
    y += 6;
  }

  const pages = doc.getNumberOfPages();
  const footerY = pageHeight - CARD_INSET - PAD - 8;
  const verifyLabel = input.verifyUrl.replace(/^https?:\/\//, "");
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.6);
    doc.line(left, footerY - 16, right, footerY - 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(FAINT);
    doc.text(
      `${statement.statementId} · SHA-256 ${shortHash(input.digest)}`,
      left,
      footerY - 4,
    );
    doc.setTextColor(INK);
    const linkText = `Verify at ${verifyLabel}`;
    doc.text(linkText, left, footerY + 6);
    doc.link(left, footerY - 2, doc.getTextWidth(linkText), 10, {
      url: input.verifyUrl,
    });
    doc.setTextColor(FAINT);
    doc.text(`Page ${page} of ${pages}`, right, footerY + 6, {
      align: "right",
    });
  }

  return doc;
}

export async function downloadPassportPdf(
  input: PassportPdfInput,
): Promise<void> {
  const doc = await renderPassportPdf(input, await loadPdfArtwork());
  doc.save(
    passportFileName(input.username, new Date(input.statement.issuedAt)),
  );
}
