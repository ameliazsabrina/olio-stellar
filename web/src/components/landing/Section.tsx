import type { ReactNode } from "react";

export function EditionsSection({
  id,
  title,
  narrative,
  children,
}: {
  id: string;
  title: string;
  narrative: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="relative flex min-h-svh flex-col justify-center py-24 pb-10 max-lg:min-h-0 max-lg:py-[76px] max-lg:pb-8"
      id={id}
      data-ed-section
    >
      <div className="max-w-[900px]">
        <h2
          className="m-0 font-sans text-[clamp(56px,9vw,128px)] font-bold leading-[0.92] tracking-[-0.03em] text-ed-cream"
          data-ed-headline
        >
          <span>{title}</span>
        </h2>
        <p
          className="mt-[30px] max-w-[34ch] text-[clamp(20px,2.2vw,28px)] font-light leading-[1.4] text-ed-cream/[0.82] first-letter:font-bold first-letter:text-ed-gold"
          data-ed-narrative
        >
          {narrative}
        </p>
      </div>
      {children ? (
        <div className="mt-14 rounded-[18px] bg-ed-cream text-ed-dark shadow-[0_40px_80px_-40px_rgba(0,0,0,0.55)]">
          <div className="p-[clamp(24px,3.4vw,56px)]">{children}</div>
        </div>
      ) : null}
    </section>
  );
}

export function EdArticle({
  title,
  variant,
  cta,
  children,
}: {
  title: string;
  variant: number;
  cta?: { label: string; href: string; external?: boolean };
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col" data-ed-article>
      <div
        className="mb-5 flex aspect-[320/180] items-center justify-center overflow-hidden rounded-xl border border-ink/[0.08] bg-gradient-to-br from-[#ece9dc] to-[#e4e0d0]"
        aria-hidden="true"
      >
        <Vignette variant={variant} />
      </div>
      <h3 className="m-0 mb-2 font-sans text-[clamp(19px,1.9vw,24px)] font-semibold tracking-[-0.01em] text-ed-dark">
        {title}
      </h3>
      <p className="m-0 text-[15.5px] leading-[1.55] text-[#565946]">
        {children}
      </p>
      {cta ? (
        <a
          className="mt-3.5 text-sm font-semibold text-ed-gold hover:text-[#8f6a1f]"
          href={cta.href}
          {...(cta.external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {cta.label} {cta.external ? "↗" : "→"}
        </a>
      ) : null}
    </article>
  );
}

/* Thin da Vinci-style line studies, one per article. Strokes inherit currentColor. */
function Vignette({ variant }: { variant: number }) {
  const v = variant % 6;
  return (
    <svg
      viewBox="0 0 320 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-[74%] w-[74%] text-[#7f8168] [&_circle]:stroke-current [&_line]:stroke-current [&_path]:stroke-current [&_rect]:stroke-current [&_circle]:fill-none [&_line]:fill-none [&_path]:fill-none [&_rect]:fill-none [&_*]:[vector-effect:non-scaling-stroke] [&_circle]:stroke-1 [&_line]:stroke-1 [&_path]:stroke-1 [&_rect]:stroke-1"
    >
      {v === 0 ? (
        <g>
          <circle cx="160" cy="90" r="64" />
          <circle cx="160" cy="90" r="44" />
          <rect
            x="128"
            y="58"
            width="64"
            height="64"
            transform="rotate(45 160 90)"
          />
          <line x1="24" y1="90" x2="96" y2="90" />
          <line x1="224" y1="90" x2="296" y2="90" />
        </g>
      ) : v === 1 ? (
        <g>
          <rect x="112" y="42" width="96" height="96" />
          <rect x="126" y="56" width="20" height="20" />
          <rect x="174" y="56" width="20" height="20" />
          <rect x="126" y="104" width="20" height="20" />
          <line x1="174" y1="104" x2="194" y2="124" />
          <line x1="194" y1="104" x2="174" y2="124" />
          <line x1="40" y1="138" x2="112" y2="138" />
          <line x1="208" y1="42" x2="280" y2="42" />
        </g>
      ) : v === 2 ? (
        <g>
          <circle cx="90" cy="90" r="52" />
          <circle cx="160" cy="90" r="52" />
          <circle cx="230" cy="90" r="52" />
          <line x1="160" y1="14" x2="160" y2="38" />
          <line x1="160" y1="142" x2="160" y2="166" />
        </g>
      ) : v === 3 ? (
        <g>
          <line x1="48" y1="140" x2="272" y2="140" />
          <path d="M96 140 L160 44 L224 140" />
          <circle cx="160" cy="44" r="14" />
          <circle cx="96" cy="140" r="6" />
          <circle cx="224" cy="140" r="6" />
          <line x1="160" y1="58" x2="160" y2="140" strokeDasharray="4 6" />
        </g>
      ) : v === 4 ? (
        <g>
          <circle cx="160" cy="90" r="66" />
          <line x1="160" y1="24" x2="160" y2="156" />
          <line x1="94" y1="90" x2="226" y2="90" />
          <line x1="113" y1="43" x2="207" y2="137" />
          <line x1="207" y1="43" x2="113" y2="137" />
          <circle cx="160" cy="90" r="8" />
        </g>
      ) : (
        <g>
          <rect x="60" y="50" width="200" height="80" rx="40" />
          <circle cx="100" cy="90" r="22" />
          <line x1="140" y1="78" x2="236" y2="78" strokeDasharray="2 8" />
          <line x1="140" y1="102" x2="212" y2="102" strokeDasharray="2 8" />
        </g>
      )}
    </svg>
  );
}
