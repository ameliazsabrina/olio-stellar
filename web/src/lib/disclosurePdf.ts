// Client-side PDF rendering of a disclosure envelope (jsPDF). The PDF is a
// self-contained receipt: a human-readable statement, the verifier's checklist,
// and the machine-readable JSON envelope so anyone can re-verify offline.

import type { jsPDF } from "jspdf";
import type { DisclosureBundle } from "./disclosure";

const INK = "#2b2a26";
const MUTED = "#6b6a63";
const OLIVE = "#5a6a3f";
const MARGIN = 56;

function truncMiddle(s: string, keep = 12): string {
  return s.length > keep * 2 + 1
    ? `${s.slice(0, keep)}…${s.slice(-keep)}`
    : s;
}

/// Render a disclosure to a jsPDF document. Exported separately from the
/// download helper so it can be unit-tested without touching the DOM. jsPDF is
/// imported lazily so it never evaluates during SSR.
export async function renderDisclosurePdf(
  bundle: DisclosureBundle,
): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const text = (
    value: string,
    opts: {
      size?: number;
      color?: string;
      style?: "normal" | "bold";
      gap?: number;
      mono?: boolean;
    } = {},
  ) => {
    const { size = 10, color = INK, style = "normal", gap = 6, mono } = opts;
    doc.setFont(mono ? "courier" : "helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(value, contentWidth) as string[];
    doc.text(lines, MARGIN, y);
    y += lines.length * (size + 2) + gap;
  };

  const rule = () => {
    doc.setDrawColor("#e4e2da");
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 16;
  };

  // Header
  text("OLIO", { size: 12, color: OLIVE, style: "bold", gap: 2 });
  text("Proof of Received Payment", { size: 20, style: "bold", gap: 4 });
  text(
    "A selective disclosure of a single confidential payment held in the Olio shielded pool. It proves this one payment and reveals nothing about any other.",
    { size: 10, color: MUTED, gap: 12 },
  );
  rule();

  // Statement
  const who = bundle.username ? `@${bundle.username}` : "the note owner";
  text("Statement", { size: 11, style: "bold", color: OLIVE, gap: 4 });
  text(
    `A payment of ${bundle.amountLabel} USDC was received by ${who} into note #${bundle.leafIndex} of the Olio shielded pool. The recipient holds the cryptographic opening of this note's commitment, proving ownership of this specific payment.`,
    { size: 11, gap: 14 },
  );

  // Key facts
  const facts: [string, string][] = [
    ["Amount", `${bundle.amountLabel} USDC`],
    ["Recipient", bundle.username ? `@${bundle.username}` : "—"],
    ["Note (leaf index)", `#${bundle.leafIndex}`],
    ["Commitment", truncMiddle(bundle.commitmentHex, 14)],
    ["Merkle root", truncMiddle(bundle.rootHex, 14)],
    ["Pool contract", truncMiddle(bundle.pool, 14)],
    ["Network", bundle.network],
    ["Disclosed at", bundle.disclosedAt],
  ];
  for (const [label, value] of facts) {
    const rowY = y;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text(label, MARGIN, rowY);
    doc.setFont("courier", "normal");
    doc.setTextColor(INK);
    doc.text(value, MARGIN + 150, rowY);
    y += 18;
  }
  y += 8;
  rule();

  // Verifier checklist
  text("How to verify", { size: 11, style: "bold", color: OLIVE, gap: 6 });
  const steps = [
    "Recompute the commitment C = Poseidon(amount, ownerPk, salt) over BN254 from the values in the JSON envelope below, and confirm it equals `commitment`.",
    "Fold the authentication path (pathElements / pathIndices) up from C and confirm the result equals `root`.",
    "Confirm the pool contract published `commitmentHex` at the stated leaf index (deposit event) and that `rootHex` was a valid historical Merkle root on-chain.",
    "Confirm `ownerPk` resolves to the stated recipient in the Olio username registry.",
  ];
  steps.forEach((s, i) => {
    text(`${i + 1}. ${s}`, { size: 9.5, color: INK, gap: 5 });
  });
  y += 6;
  text(
    "Passing checks 1–2 proves the discloser knew this note's secret opening (ownership). Checks 3–4 anchor it to a real, funded, on-chain deposit and to the named recipient.",
    { size: 9, color: MUTED, gap: 14 },
  );
  rule();

  // Machine-readable envelope
  text("Disclosure envelope (JSON)", {
    size: 11,
    style: "bold",
    color: OLIVE,
    gap: 6,
  });
  text(JSON.stringify(bundle, null, 2), {
    size: 7.5,
    mono: true,
    color: INK,
    gap: 4,
  });

  return doc;
}

/// Trigger a browser download of the disclosure PDF.
export async function downloadDisclosurePdf(
  bundle: DisclosureBundle,
): Promise<void> {
  const doc = await renderDisclosurePdf(bundle);
  doc.save(`olio-receipt-note-${bundle.leafIndex}.pdf`);
}
