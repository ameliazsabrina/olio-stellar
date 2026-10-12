"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const PILLARS = [
  {
    numeral: "I",
    title: "Private",
    line: "Competitors, customers and strangers can't read your revenue.",
    proof:
      "Payments settle confidentially, and invoice contents are encrypted in your browser.",
    className: "lg:col-span-4 lg:col-start-8 lg:row-start-1 lg:mt-20",
  },
  {
    numeral: "II",
    title: "Provable",
    line: "Answer your bank, accountant or tax office.",
    proof:
      "Each payment is matched to its invoice on chain, so nobody can mark it paid by hand. Disclose a single payment as a PDF receipt when you need to.",
    className: "lg:col-span-4 lg:col-start-2 lg:row-start-2 lg:-mt-6",
  },
  {
    numeral: "III",
    title: "Verified",
    line: "Customers know they're paying a real business.",
    proof:
      "Every business is verified, with an Identity Verified badge you choose when to publish.",
    className:
      "md:col-span-2 lg:col-span-4 lg:col-start-7 lg:row-start-2 lg:mt-24",
  },
] as const;

const SLIP_CLASS =
  "bg-paper px-5 py-5 text-ink shadow-[0_18px_60px_rgba(32,38,26,0.08)] md:px-6 md:py-6 lg:px-7 lg:py-7";

export function Solution() {
  const rootRef = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;

      const background = root.querySelector<HTMLElement>(
        "[data-solution-background]",
      );
      const mm = gsap.matchMedia(root);

      mm.add(
        {
          reduceMotion: "(prefers-reduced-motion: reduce)",
          allowMotion: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          const { reduceMotion } = context.conditions as {
            reduceMotion: boolean;
            allowMotion: boolean;
          };

          if (reduceMotion) {
            if (background) {
              gsap.set(background, { clearProps: "transform,willChange" });
            }
            return;
          }

          if (background) {
            gsap.fromTo(
              background,
              {
                yPercent: -8,
              },
              {
                yPercent: 8,
                ease: "none",
                scrollTrigger: {
                  trigger: root,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: 0.6,
                },
              },
            );
          }
        },
      );

      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <section
      ref={rootRef}
      className="relative z-20 min-h-[80vh] overflow-hidden bg-ed-dark text-ink"
      id="solution"
      data-ed-section
      aria-labelledby="solution-title"
    >
      <div
        className="absolute -inset-y-[10%] inset-x-0 will-change-transform"
        data-solution-background
        aria-hidden="true"
      >
        <Image
          className="object-cover"
          src="/assets/section3-bg.webp"
          alt=""
          fill
          sizes="100vw"
        />
      </div>
      <div
        className="absolute inset-0 bg-paper/12 mix-blend-screen"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(32,38,26,0.08),rgba(32,38,26,0.28)),radial-gradient(70%_60%_at_20%_12%,rgba(245,243,234,0.35),transparent_58%)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid min-h-[80vh] max-w-7xl grid-cols-1 content-center gap-4 px-5 py-6 sm:px-6 md:grid-cols-2 md:p-8 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-0 lg:px-(--page-gutter) lg:py-(--section-space-compact)">
        <div
          className={`md:col-span-2 lg:col-span-5 lg:col-start-1 lg:row-start-1 lg:self-start ${SLIP_CLASS}`}
        >
          <h2
            className="max-w-[13ch] text-balance font-heading text-[clamp(1.55rem,2.35vw,2.7rem)] font-semibold leading-[1.03] tracking-[-0.025em]"
            id="solution-title"
          >
            Private by default. Provable when needed.
          </h2>
        </div>

        {PILLARS.map((pillar) => (
          <article
            className={`lg:self-start ${SLIP_CLASS} ${pillar.className}`}
            key={pillar.numeral}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-heading text-[clamp(1.4rem,1.9vw,1.9rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
                {pillar.title}
              </h3>
            </div>
            <p className="mt-3 max-w-[30ch] text-[1.05rem] font-semibold leading-[1.3] tracking-[-0.01em]">
              {pillar.line}
            </p>
            <p className="mt-4 border-t border-line-soft pt-4 text-[0.92rem] font-medium leading-[1.5] text-muted-text">
              {pillar.proof}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
