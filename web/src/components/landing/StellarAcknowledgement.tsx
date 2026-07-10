import Image from "next/image";
import type { CSSProperties } from "react";

const STELLAR_FEATURES = [
  "Fast settlement",
  "Low transaction costs",
  "Native USDC support",
  "Cross-border payments",
  "Cash-out to local currency",
] as const;

const SWAY = ["-10px", "8px", "-12px", "9px", "-8px"] as const;

type StellarSwayStyle = CSSProperties & {
  "--stellar-delay": string;
  "--stellar-sway-y": string;
};

export function StellarAcknowledgement() {
  return (
    <section
      className="relative z-20 overflow-hidden bg-paper px-[clamp(20px,5vw,72px)] py-24 text-ink sm:py-28"
      id="stellar"
      aria-labelledby="stellar-title"
    >
      <div className="mx-auto max-w-6xl text-center">
        <h2
          className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-center gap-x-6 gap-y-3 text-balance text-[clamp(1rem,7.5vw,6rem)] font-semibold leading-[0.86] tracking-[-0.065em] text-ink"
          id="stellar-title"
        >
          <span>Built on</span>
          <span className="ml-4 inline-flex w-[clamp(10.5rem,18vw,17rem)] translate-y-[0.08em] items-center justify-center">
            <Image
              src="/assets/stellar-logo.png"
              alt="Stellar"
              width={623}
              height={156}
              className="h-auto w-full object-contain"
            />
          </span>
        </h2>
      </div>

      <div
        className="pointer-events-none mt-20 flex w-max gap-5 stellar-marquee"
        aria-hidden="true"
      >
        <FeatureStrip />
        <FeatureStrip />
      </div>

      <ul className="sr-only">
        {STELLAR_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </section>
  );
}

function FeatureStrip() {
  return (
    <div className="flex shrink-0 items-center gap-5 px-2">
      {STELLAR_FEATURES.map((feature, index) => (
        <div
          className="stellar-sway flex h-20 min-w-[260px] items-center justify-center rounded-full border-2  bg-olive-deep px-9 text-[clamp(1.2rem,2.1vw,2rem)] font-medium tracking-[-0.025em] text-paper shadow-[0_12px_36px_rgba(32,38,26,0.05)] md:min-w-[330px]"
          key={feature}
          style={
            {
              "--stellar-delay": `${index * -0.55}s`,
              "--stellar-sway-y": SWAY[index],
            } as StellarSwayStyle
          }
        >
          {feature}
        </div>
      ))}
    </div>
  );
}
