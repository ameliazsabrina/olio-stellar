import type { PdfArtwork } from "./documentPdf";

export const PDF_BANNER_PATH = "/assets/receipt-banner.jpg";
export const PDF_LOGO_PATH = "/assets/receipt-logo.png";

let cached: Promise<PdfArtwork> | null = null;

async function fetchBytes(path: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export function loadPdfArtwork(): Promise<PdfArtwork> {
  if (typeof window === "undefined")
    return Promise.resolve({ banner: null, logo: null });
  cached ??= Promise.all([
    fetchBytes(PDF_BANNER_PATH),
    fetchBytes(PDF_LOGO_PATH),
  ]).then(([banner, logo]) => {
    if (!banner || !logo) cached = null;
    return { banner, logo };
  });
  return cached;
}
