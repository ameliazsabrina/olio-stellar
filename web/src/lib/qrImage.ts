import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { DOCUMENT_PDF_PALETTE } from "./documentPdf";

const FRAME_MS = 16;
const MAX_FRAMES = 20;

/**
 * Renders `value` with qrcode.react's canvas renderer off-screen and returns
 * a PNG data URL for embedding in a PDF. Returns null outside a browser or if
 * the canvas never draws.
 */
export async function qrPngDataUrl(
  value: string,
  size = 512,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const { QRCodeCanvas } = await import("qrcode.react");
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(
      createElement(QRCodeCanvas, {
        value,
        size,
        level: "M",
        marginSize: 0,
        bgColor: DOCUMENT_PDF_PALETTE.card,
        fgColor: DOCUMENT_PDF_PALETTE.ink,
      }),
    );
    // The canvas mounts on commit and draws in an effect, so wait a frame
    // after it appears before reading pixels.
    let seen = false;
    for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
      await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
      const canvas = host.querySelector("canvas");
      if (canvas && seen) return canvas.toDataURL("image/png");
      seen = canvas !== null;
    }
    return null;
  } catch {
    return null;
  } finally {
    root.unmount();
    host.remove();
  }
}
