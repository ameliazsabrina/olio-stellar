export const panel =
  "rounded-[10px] border border-line bg-panel p-6 flex flex-col gap-3";

export const sub = "text-sm text-muted";

export const hint = "text-xs text-muted";

export const field = "grid gap-2";

export const inline = "flex flex-wrap items-center gap-3";

export const input =
  "min-h-11 w-full rounded-lg border border-line bg-white px-3.5 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-1";

export const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-olive bg-olive px-[18px] font-semibold text-paper transition-colors hover:bg-olive-deep disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-olive";

export const btnSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-olive bg-transparent px-[18px] font-semibold text-olive-deep transition-colors hover:bg-sage disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export const btnLink =
  "min-h-0 border-0 bg-none p-0 font-semibold text-olive-deep underline";

export function status(kind: "info" | "ok" | "err") {
  const tone =
    kind === "ok"
      ? "border-ok/40 bg-ok/10 text-ok"
      : kind === "err"
        ? "border-err/40 bg-err/10 text-err"
        : "border-line bg-sage text-olive-deep";
  return `rounded-lg border px-4 py-3 text-sm ${tone}`;
}

export const tag =
  "inline-flex items-center rounded-full border border-line bg-sage px-2.5 py-1 text-xs font-semibold text-olive-deep";

export const bignum = "text-4xl font-bold text-ink";

export const heroSection = "grid gap-2 pt-4";
export const heroTitle = "text-3xl font-bold text-ink";

export const foot = "pt-8 text-center text-xs text-muted";

export const linkrow = "break-all font-mono text-sm text-muted";

export const balgrid = "my-2 grid grid-cols-3 gap-3";
export const balcell =
  "flex flex-col gap-1 rounded-lg border border-line bg-sage/40 px-3 py-2";
export const ballabel = "text-xs uppercase tracking-wide text-muted";
export const balval = "font-mono text-lg font-semibold text-ink";

export const notes = "mt-2 grid gap-2";
export const note =
  "flex items-center gap-3 rounded-lg border border-line px-3 py-2";
export const amt = "font-semibold text-ink";

export const edGrid =
  "grid grid-cols-2 gap-[clamp(24px,3vw,44px)] [@media(max-width:620px)]:grid-cols-1";
