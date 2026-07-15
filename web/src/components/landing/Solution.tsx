"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SOLUTION_BOXES = [
  {
    label: "I",
    text: "Private by default. Provable when needed.",
    className: "lg:left-[6vw] lg:top-[8%] lg:w-[360px]",
    textClassName: "text-[clamp(1.55rem,2.35vw,2.7rem)] leading-[1.03]",
    widthClassName: "max-w-[13ch]",
  },
  {
    label: "II",
    text: "Olio creates a private payment receipt every time you get paid.",
    className: "lg:left-[43vw] lg:top-[22%] lg:w-[300px]",
    textClassName: "text-[clamp(1.1rem,1.45vw,1.45rem)] leading-[1.08]",
    widthClassName: "max-w-[14ch]",
  },
  {
    label: "III",
    text: "Clients simply pay your payment link.",
    className: "lg:right-[7vw] lg:top-[38%] lg:w-[300px]",
    textClassName: "text-[clamp(1.15rem,1.75vw,1.75rem)] leading-[1.05]",
    widthClassName: "max-w-[12ch]",
  },
  {
    label: "IV",
    text: "Behind the scenes, your payment becomes confidential while remaining verifiable if you ever need to show proof to banks, accountants, and tax authorities.",
    className: "lg:left-[24vw] lg:bottom-[14%] lg:w-[500px]",
    textClassName: "text-[clamp(0.95rem,1.18vw,1.15rem)] leading-[1.16]",
    widthClassName: "max-w-[31ch]",
  },
  {
    label: "V",
    text: "No complicated crypto knowledge required.",
    className: "lg:left-[63vw] lg:bottom-[7%] lg:w-[300px]",
    textClassName: "text-[clamp(1.15rem,1.75vw,1.75rem)] leading-[1.05]",
    widthClassName: "max-w-[13ch]",
  },
] as const;

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
      className="relative z-20 min-h-[80vh] overflow-hidden bg-ed-dark text-ink lg:h-[80vh]"
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
          src="/assets/section3-bg.jpg"
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

      <div className="relative grid min-h-[80vh] grid-cols-1 gap-4 p-5 sm:p-6 md:grid-cols-2 md:gap-4 md:p-8 lg:block lg:h-[80vh] lg:p-0">
        <h2 className="sr-only" id="solution-title">
          Private by default. Provable when needed.
        </h2>

        {SOLUTION_BOXES.map((box) => (
          <article
            className={`flex min-h-[136px] items-start bg-paper px-5 py-5 text-ink shadow-[0_18px_60px_rgba(32,38,26,0.08)] md:last:col-span-2 md:min-h-[160px] md:px-6 md:py-6 lg:absolute lg:min-h-0 lg:px-7 lg:py-7 ${box.className}`}
            key={box.label}
          >
            <p
              className={`${box.widthClassName} text-balance font-heading font-semibold tracking-[-0.025em] ${box.textClassName}`}
            >
              {box.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
