import type { jsPDF } from "jspdf";
import { fromBaseUnits } from "./crypto";

export type PdfDocumentKind = "receipt" | "invoice";

export type PdfParty = {
  heading: string;
  name: string;
  lines: string[];
};

export type PdfLineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

export type PdfDocumentModel = {
  kind: PdfDocumentKind;
  number: string;
  from: PdfParty;
  to: PdfParty | null;
  dates: [string, string][];
  items: PdfLineItem[];
  totals: { label: string; value: string; emphasis?: boolean }[];
  payment: PdfPaymentDetail[];
  notes: string | null;
};

export type PdfPaymentDetail = {
  label: string;
  value: string;
  href?: string;
};

export type PdfArtwork = {
  banner: Uint8Array | null;
  logo: Uint8Array | null;
};

export const DOCUMENT_PDF_PALETTE = {
  ink: "#1A1F12",
  canvas: "#E6E6E3",
  card: "#FFFFFF",
  band: "#EDEDEA",
} as const;

export function mixHex(
  foreground: string,
  background: string,
  ratio: number,
): string {
  const channel = (color: string, offset: number) =>
    Number.parseInt(color.slice(offset, offset + 2), 16);
  const mixed = [1, 3, 5].map((offset) =>
    Math.round(
      channel(foreground, offset) * ratio +
        channel(background, offset) * (1 - ratio),
    ),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const INK = DOCUMENT_PDF_PALETTE.ink;
const MUTED = mixHex(INK, DOCUMENT_PDF_PALETTE.card, 0.55);
const FAINT = mixHex(INK, DOCUMENT_PDF_PALETTE.card, 0.42);
const RULE = mixHex(INK, DOCUMENT_PDF_PALETTE.card, 0.14);

const CARD_INSET = 24;
const PAD = 28;
const BANNER_HEIGHT = 112;
const ROW_HEIGHT = 26;
const LINE = 12.5;
const COLUMN_LINES = 5;
const PAYMENT_LINES = 7;
const NOTE_LINES = 4;

export function formatUsdc(units: bigint): string {
  const [whole, frac = ""] = fromBaseUnits(units).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac.padEnd(2, "0")} USDC`;
}

export function formatPdfDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function compactDay(date: Date): string {
  return isoDay(date).replaceAll("-", "");
}

export function pdfFileName(
  kind: PdfDocumentKind,
  username: string | null | undefined,
  date: Date,
): string {
  const prefix = kind === "receipt" ? "OlioReceipt" : "OlioInvoice";
  const safeName = (username ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return `${[prefix, safeName, isoDay(date)].filter(Boolean).join("-")}.pdf`;
}

export function clampLines(
  doc: jsPDF,
  text: string,
  width: number,
  max: number,
) {
  const lines = text
    .split("\n")
    .flatMap((line) => doc.splitTextToSize(line, width) as string[]);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fitLine(doc, `${kept[max - 1]}…`, width);
  return kept;
}

export function fitLine(doc: jsPDF, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text;
  let end = text.length;
  while (end > 1 && doc.getTextWidth(`${text.slice(0, end)}…`) > width)
    end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

const LABEL_TRACKING = 0.6;

type PaymentLine = { text: string; href?: string };

export function label(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  align?: "right",
) {
  const upper = text.toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(FAINT);
  const tracked = doc.getTextWidth(upper) + LABEL_TRACKING * (upper.length - 1);
  doc.setCharSpace(LABEL_TRACKING);
  doc.text(upper, align === "right" ? x - tracked : x, y);
  doc.setCharSpace(0);
}

function drawParty(
  doc: jsPDF,
  party: PdfParty,
  x: number,
  y: number,
  width: number,
): number {
  label(doc, party.heading, x, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text(fitLine(doc, party.name, width), x, y + 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  const lines = clampLines(doc, party.lines.join("\n"), width, COLUMN_LINES);
  lines.forEach((line, index) => {
    doc.text(line, x, y + 30 + index * LINE);
  });
  return y + 30 + Math.max(0, lines.length - 1) * LINE;
}

const LOGO_HEIGHT = 30;

export function drawBadge(
  doc: jsPDF,
  logo: Uint8Array | null,
  cx: number,
  cy: number,
) {
  const x = cx - 22;
  if (logo) {
    const { width, height } = doc.getImageProperties(logo);
    const logoWidth = (LOGO_HEIGHT * width) / height;
    doc.addImage(
      logo,
      "PNG",
      x,
      cy - LOGO_HEIGHT / 2,
      logoWidth,
      LOGO_HEIGHT,
      undefined,
      "FAST",
    );
    return;
  }
  doc.setFont("times", "bold");
  doc.setFontSize(34);
  doc.setTextColor(INK);
  doc.text("Olio", x, cy + 11);
}

export async function renderDocumentPdf(
  model: PdfDocumentModel,
  artwork: PdfArtwork = { banner: null, logo: null },
): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = CARD_INSET + PAD;
  const right = pageWidth - CARD_INSET - PAD;
  const width = right - left;
  const bottom = pageHeight - CARD_INSET - PAD;
  const title = model.kind === "receipt" ? "RECEIPT" : "INVOICE";

  doc.setProperties({
    title: `Olio ${model.kind} ${model.number}`,
    subject: model.kind === "receipt" ? "Payment receipt" : "Invoice",
    author: "Olio",
    creator: "Olio",
  });

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

  const bannerTop = CARD_INSET + PAD;
  if (artwork.banner) {
    doc.addImage(artwork.banner, "JPEG", left, bannerTop, width, BANNER_HEIGHT);
  } else {
    doc.setFillColor(DOCUMENT_PDF_PALETTE.band);
    doc.roundedRect(left, bannerTop, width, BANNER_HEIGHT, 10, 10, "F");
  }

  const badgeY = bannerTop + BANNER_HEIGHT + 40;
  drawBadge(doc, artwork.logo, left + 22, badgeY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(INK);
  doc.text(model.number, right, badgeY - 12, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(52);
  doc.setTextColor(INK);
  const titleY = badgeY + 74;
  doc.text(title, left - 2, titleY);

  const columnsY = titleY + 34;
  const columnWidth = 150;
  let columnsBottom = drawParty(doc, model.from, left, columnsY, columnWidth);
  if (model.to) {
    columnsBottom = Math.max(
      columnsBottom,
      drawParty(doc, model.to, left + 176, columnsY, columnWidth + 20),
    );
  }
  model.dates.forEach(([dateLabel, value], index) => {
    const y = columnsY + index * 30;
    label(doc, dateLabel, right, y, "right");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text(value, right, y + 14, { align: "right" });
    columnsBottom = Math.max(columnsBottom, y + 14);
  });

  const qtyX = left + 300;
  const priceX = left + 392;
  const headerY = columnsBottom + 36;
  label(doc, "Description", left, headerY);
  label(doc, "Qty", qtyX, headerY, "right");
  label(doc, "Price", priceX, headerY, "right");
  label(doc, "Amount", right, headerY, "right");
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.6);
  doc.line(left, headerY + 8, right, headerY + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const infoWidth = width * 0.72;
  const paymentLines = model.payment
    .flatMap(({ label: key, value, href }): PaymentLine[] =>
      href
        ? [{ text: fitLine(doc, `${key}: ${value}`, infoWidth), href }]
        : clampLines(doc, `${key}: ${value}`, infoWidth, 3).map((text) => ({
            text,
          })),
    )
    .slice(0, PAYMENT_LINES);
  const noteLines = model.notes
    ? clampLines(doc, model.notes, infoWidth, NOTE_LINES)
    : [];
  const leftBlock =
    (paymentLines.length ? 14 + paymentLines.length * LINE : 0) +
    (noteLines.length ? 24 + noteLines.length * LINE : 0);
  const totalsBlock = model.totals.length * 21 + 8;
  const tailHeight = 30 + totalsBlock + 16 + leftBlock;

  const rowsTop = headerY + 8;
  const capacity = Math.max(
    1,
    Math.floor((bottom - rowsTop - tailHeight) / ROW_HEIGHT),
  );
  const overflow = model.items.length > capacity;
  const shown = overflow ? model.items.slice(0, capacity - 1) : model.items;

  let rowY = rowsTop;
  const drawRow = (item: PdfLineItem, faint = false) => {
    const baseline = rowY + 17;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(faint ? MUTED : INK);
    doc.text(fitLine(doc, item.description, qtyX - left - 40), left, baseline);
    doc.setTextColor(FAINT);
    doc.text(item.quantity, qtyX, baseline, { align: "right" });
    doc.text(item.unitPrice, priceX, baseline, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(INK);
    doc.text(item.amount, right, baseline, { align: "right" });
    rowY += ROW_HEIGHT;
    doc.setDrawColor(RULE);
    doc.line(left, rowY, right, rowY);
  };
  for (const item of shown) drawRow(item);
  if (overflow) {
    const hidden = model.items.length - shown.length;
    drawRow(
      {
        description: `+ ${hidden} more ${hidden === 1 ? "item" : "items"}`,
        quantity: "",
        unitPrice: "",
        amount: "",
      },
      true,
    );
  }

  const totalsX = left + width * 0.62;
  let totalY = rowY + 30;
  for (const total of model.totals) {
    if (total.emphasis) {
      doc.setDrawColor(INK);
      doc.setLineWidth(0.6);
      doc.line(totalsX, totalY - 13, right, totalY - 13);
    }
    doc.setFont("helvetica", total.emphasis ? "bold" : "normal");
    doc.setFontSize(total.emphasis ? 10.5 : 9.5);
    doc.setTextColor(total.emphasis ? INK : MUTED);
    doc.text(total.label, totalsX, totalY);
    doc.setTextColor(INK);
    doc.text(total.value, right, totalY, { align: "right" });
    totalY += 21;
  }

  let infoY = totalY + 16;
  if (paymentLines.length) {
    label(doc, "Payment details", left, infoY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    paymentLines.forEach(({ text, href }, index) => {
      const y = infoY + 15 + index * LINE;
      doc.setTextColor(href ? INK : MUTED);
      doc.text(text, left, y);
      if (href) {
        const lineWidth = doc.getTextWidth(text);
        doc.setDrawColor(INK);
        doc.setLineWidth(0.4);
        doc.line(left, y + 1.5, left + lineWidth, y + 1.5);
        doc.link(left, y - 9, lineWidth, 12, { url: href });
      }
    });
    infoY += 15 + paymentLines.length * LINE + 14;
  }
  if (noteLines.length) {
    label(doc, "Notes", left, infoY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    noteLines.forEach((line, index) => {
      doc.text(line, left, infoY + 15 + index * LINE);
    });
  }

  return doc;
}
