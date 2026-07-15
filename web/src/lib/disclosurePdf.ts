// Client-side PDF rendering of a selective-disclosure receipt. The first page
// is intentionally written for everyday payment recipients; cryptographic and
// machine-readable details are kept in a separate verification appendix.

import type { jsPDF } from "jspdf";
import type { DisclosureBundle } from "./disclosure";

const PAPER = "#f5f3ea";
const PANEL = "#fffdf7";
const INK = "#20261a";
const MUTED = "#6b6e5d";
const OLIVE = "#4c5d34";
const OLIVE_DEEP = "#333e22";
const SAGE = "#e8e9dd";
const LINE = "#d6d6c8";
const OK = "#16784c";
const MARGIN = 56;

function truncMiddle(value: string, keep = 12): string {
  return value.length > keep * 2 + 1
    ? `${value.slice(0, keep)}…${value.slice(-keep)}`
    : value;
}

function receiptReference(bundle: DisclosureBundle): string {
  const leaf = String(bundle.leafIndex).padStart(4, "0");
  return `OLIO-${leaf}-${bundle.commitmentHex.slice(0, 8).toUpperCase()}`;
}

function displayNetwork(network: string): string {
  return network.toLowerCase().includes("test")
    ? "Stellar test network"
    : "Stellar network";
}

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

async function loadBrandLogo(): Promise<Uint8Array | null> {
  try {
    const response = await fetch("/assets/olio-receipt-logo.png");
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    // Node-based PDF tests do not have a browser origin. They use the textual
    // wordmark fallback while browser downloads receive the real Olio asset.
    return null;
  }
}

function fillPage(doc: jsPDF): void {
  doc.setFillColor(PAPER);
  doc.rect(
    0,
    0,
    doc.internal.pageSize.getWidth(),
    doc.internal.pageSize.getHeight(),
    "F",
  );
}

function drawWordmark(
  doc: jsPDF,
  logo: Uint8Array | null,
  x: number,
  y: number,
  color: string,
): void {
  if (logo) {
    doc.addImage(logo, "PNG", x, y, 58, 28);
    return;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(color);
  doc.text("olio", x, y + 22);
}

function drawPageFooter(
  doc: jsPDF,
  page: number,
  total: number,
  reference: string,
): void {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  doc.setDrawColor(LINE);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, height - 42, width - MARGIN, height - 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(`Olio  •  ${reference}`, MARGIN, height - 25);
  doc.text(`Page ${page} of ${total}`, width - MARGIN, height - 25, {
    align: "right",
  });
}

function drawTechnicalHeader(
  doc: jsPDF,
  logo: Uint8Array | null,
  title: string,
  subtitle: string,
): number {
  const width = doc.internal.pageSize.getWidth();
  fillPage(doc);
  doc.setFillColor(OLIVE_DEEP);
  doc.rect(0, 0, width, 10, "F");
  drawWordmark(doc, logo, MARGIN, 34, OLIVE_DEEP);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(INK);
  const [firstTitleWord, ...remainingTitleWords] = title.split(" ");
  doc.text(firstTitleWord, MARGIN, 102);
  if (remainingTitleWords.length > 0) {
    doc.setTextColor(INK);
    doc.text(
      remainingTitleWords.join(" "),
      MARGIN + doc.getTextWidth(firstTitleWord) + 6,
      102,
    );
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  const lines = doc.splitTextToSize(subtitle, width - MARGIN * 2) as string[];
  doc.text(lines, MARGIN, 122);
  return 122 + lines.length * 12 + 12;
}

/// Render a disclosure to a jsPDF document. Exported separately from the
/// download helper so it can be unit-tested without touching the DOM. jsPDF is
/// imported lazily so it never evaluates during SSR.
export async function renderDisclosurePdf(
  bundle: DisclosureBundle,
): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const logo = await loadBrandLogo();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const reference = receiptReference(bundle);
  const recipient = bundle.username
    ? `@${bundle.username}`
    : "Private Olio account";

  doc.setProperties({
    title: `Olio payment receipt ${reference}`,
    subject: "Confirmation of a received private payment",
    author: "Olio",
    creator: "Olio",
    keywords: "Olio, payment receipt, USDC, Stellar",
  });

  // Page 1: friendly receipt
  fillPage(doc);
  doc.setFillColor(OLIVE_DEEP);
  doc.rect(0, 0, pageWidth, 150, "F");
  drawWordmark(doc, logo, MARGIN, 40, PAPER);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(PAPER);
  doc.text("PRIVATE PAYMENT RECEIPT", pageWidth - MARGIN, 57, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Issued by Olio", pageWidth - MARGIN, 76, { align: "right" });

  doc.setFillColor(PANEL);
  doc.roundedRect(MARGIN, 180, contentWidth, 176, 14, 14, "F");
  doc.setFillColor(SAGE);
  doc.roundedRect(MARGIN + 22, 202, 112, 25, 12, 12, "F");
  doc.setFillColor(OK);
  doc.circle(MARGIN + 37, 214.5, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(OLIVE_DEEP);
  doc.text("PAYMENT RECEIVED", MARGIN + 48, 218);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(INK);
  doc.text("Payment confirmation", MARGIN + 22, 260);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(32);
  doc.text(`${bundle.amountLabel} USDC`, MARGIN + 22, 303);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(MUTED);
  doc.text("USD Coin received privately through Olio", MARGIN + 22, 325);

  const rightX = pageWidth - MARGIN - 160;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text("RECEIVED BY", rightX, 259);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text(recipient, rightX, 279);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text("RECEIPT REFERENCE", rightX, 311);
  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INK);
  doc.text(reference, rightX, 330);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text("Receipt details", MARGIN, 398);

  const detailRows: [string, string, string, string][] = [
    [
      "DATE AND TIME",
      `${displayDate(bundle.disclosedAt)} UTC`,
      "PAYMENT STATUS",
      "Received",
    ],
    [
      "PAYMENT NETWORK",
      displayNetwork(bundle.network),
      "PAYMENT REFERENCE",
      `Private payment #${bundle.leafIndex}`,
    ],
  ];
  let rowY = 430;
  for (const [leftLabel, leftValue, rightLabel, rightValue] of detailRows) {
    doc.setFillColor(PANEL);
    doc.roundedRect(MARGIN, rowY - 18, contentWidth, 64, 10, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(leftLabel, MARGIN + 18, rowY);
    doc.text(rightLabel, MARGIN + contentWidth / 2 + 12, rowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(INK);
    doc.text(leftValue, MARGIN + 18, rowY + 21);
    doc.text(rightValue, MARGIN + contentWidth / 2 + 12, rowY + 21);
    rowY += 76;
  }

  doc.setFillColor(SAGE);
  doc.roundedRect(MARGIN, 588, contentWidth, 112, 12, 12, "F");
  doc.setFillColor(OLIVE);
  doc.circle(MARGIN + 24, 616, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(OLIVE_DEEP);
  doc.text("Verified by Olio", MARGIN + 44, 614);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const confirmation = doc.splitTextToSize(
    "This receipt confirms that the named recipient can prove ownership of this specific payment. It does not reveal their balance or any other payment activity.",
    contentWidth - 68,
  ) as string[];
  doc.text(confirmation, MARGIN + 44, 635);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(
    "Independent verification details are included on the following pages.",
    MARGIN + 44,
    679,
  );

  // Page 2: concise verification guide
  doc.addPage();
  let y = drawTechnicalHeader(
    doc,
    null,
    "Verification details",
    "This section is for accountants, auditors, and technical reviewers. No technical action is needed to use the receipt as a normal payment record.",
  );

  doc.setFillColor(PANEL);
  doc.roundedRect(MARGIN, y, contentWidth, 216, 12, 12, "F");
  y += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text("Payment identifiers", MARGIN + 18, y);
  y += 24;
  const technicalFacts: [string, string][] = [
    ["Private payment index", `#${bundle.leafIndex}`],
    ["Commitment", truncMiddle(bundle.commitmentHex, 16)],
    ["Verified ledger root", truncMiddle(bundle.rootHex, 16)],
    ["Olio pool contract", truncMiddle(bundle.pool, 16)],
    ["Network", displayNetwork(bundle.network)],
  ];
  for (const [label, value] of technicalFacts) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(label, MARGIN + 18, y);
    doc.setFont("courier", "normal");
    doc.setTextColor(INK);
    doc.text(value, MARGIN + 160, y);
    y += 30;
  }

  y += 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text("How an independent verifier checks it", MARGIN, y);
  y += 25;
  const verificationSteps = [
    "Recreate the private payment fingerprint from the amount, recipient key, and one-time secret in the appendix.",
    "Use the included proof path to confirm that fingerprint belongs to the verified ledger root shown above.",
    "Confirm the Olio pool published the fingerprint at the stated payment index and recognized that ledger root.",
    "Confirm the recipient key maps to the Olio username shown on the receipt.",
  ];
  verificationSteps.forEach((step, index) => {
    doc.setFillColor(OLIVE);
    doc.circle(MARGIN + 11, y - 3, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(PAPER);
    doc.text(String(index + 1), MARGIN + 11, y, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(INK);
    const lines = doc.splitTextToSize(step, contentWidth - 42) as string[];
    doc.text(lines, MARGIN + 34, y);
    y += Math.max(38, lines.length * 12 + 14);
  });

  doc.setFillColor(SAGE);
  doc.roundedRect(MARGIN, y + 4, contentWidth, 58, 10, 10, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(OLIVE_DEEP);
  const privacyNote = doc.splitTextToSize(
    "Privacy note: verification proves only this payment. The recipient's remaining balance and other transactions stay private.",
    contentWidth - 30,
  ) as string[];
  doc.text(privacyNote, MARGIN + 15, y + 27);

  // Page 3+: raw verification data, paginated instead of overflowing one page.
  doc.setFont("courier", "normal");
  doc.setFontSize(7.5);
  const rawLines = JSON.stringify(bundle, null, 2)
    .split("\n")
    .flatMap(
      (line) => doc.splitTextToSize(line, contentWidth - 28) as string[],
    );
  const linesPerPage = 64;
  for (let offset = 0; offset < rawLines.length; offset += linesPerPage) {
    doc.addPage();
    const appendixY = drawTechnicalHeader(
      doc,
      null,
      offset === 0
        ? "Verification appendix"
        : "Verification appendix (continued)",
      "Machine-readable data included so this receipt can be checked independently.",
    );
    doc.setFillColor(PANEL);
    doc.roundedRect(
      MARGIN,
      appendixY,
      contentWidth,
      pageHeight - appendixY - 62,
      10,
      10,
      "F",
    );
    doc.setFont("courier", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(INK);
    doc.text(
      rawLines.slice(offset, offset + linesPerPage),
      MARGIN + 14,
      appendixY + 20,
      { lineHeightFactor: 1.28 },
    );
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageFooter(doc, page, totalPages, reference);
  }

  return doc;
}

/// Trigger a browser download of the disclosure PDF.
export async function downloadDisclosurePdf(
  bundle: DisclosureBundle,
): Promise<void> {
  const doc = await renderDisclosurePdf(bundle);
  doc.save(`olio-receipt-${receiptReference(bundle).toLowerCase()}.pdf`);
}
