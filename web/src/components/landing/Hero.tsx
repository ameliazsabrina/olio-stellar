"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { useRef, useState } from "react";
import { StellarWalletModal } from "./StellarWalletModal";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const MENU = [
  { id: "problem", numeral: "I", label: "Why privacy matters?" },
  { id: "solution", numeral: "II", label: "How Olio protects you?" },
  { id: "users", numeral: "III", label: "Who it's for?" },
  { id: "faq", numeral: "IV", label: "Frequently Asked Questions" },
];

export function Hero() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;

      const q = gsap.utils.selector(root);
      const bg = q("[data-ed-bg]")[0] as HTMLElement | undefined;
      const frameRect = q("[data-ed-frame] rect")[0] as unknown as
        | SVGRectElement
        | undefined;
      const box = q("[data-ed-hero-frame]")[0] as HTMLElement | undefined;
      if (!box) return;

      const mm = gsap.matchMedia(root);
      mm.add(
        {
          isDesktop: "(min-width: 1025px)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const { isDesktop, reduceMotion } = context.conditions as {
            isDesktop: boolean;
            reduceMotion: boolean;
          };

          if (reduceMotion) return;

          const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
          if (frameRect) {
            tl.from(
              frameRect,
              { strokeDashoffset: 1, duration: 1.4, ease: "power2.out" },
              0,
            );
          }
          tl.from(
            q("[data-ed-hero-inner] > *"),
            {
              y: 22,
              autoAlpha: 0,
              duration: 0.9,
              stagger: 0.12,
              ease: "power2.out",
            },
            0.18,
          );

          // Scroll parallax: hero box eases out while hand artwork stays static.
          const parallax = gsap.timeline({
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "bottom top",
              scrub: 0.6,
            },
          });
          parallax.to(box, { y: -40, autoAlpha: 0.35, ease: "none" }, 0);

          if (!isDesktop || !bg) return;

          gsap.set(bg, { scale: 1.1, transformOrigin: "center center" });
          const xTo = gsap.quickTo(bg, "x", {
            duration: 0.8,
            ease: "power3.out",
          });
          const yTo = gsap.quickTo(bg, "y", {
            duration: 0.8,
            ease: "power3.out",
          });

          const clamp = gsap.utils.clamp(-1, 1);

          const onMove = (e: PointerEvent) => {
            const rect = root.getBoundingClientRect();
            const nx = clamp(
              gsap.utils.mapRange(0, rect.width, -1, 1, e.clientX - rect.left),
            );
            const ny = clamp(
              gsap.utils.mapRange(0, rect.height, -1, 1, e.clientY - rect.top),
            );
            // Follow the cursor's direction, subtly.
            xTo(nx * 14);
            yTo(ny * 10);
          };
          const onLeave = () => {
            xTo(0);
            yTo(0);
          };
          root.addEventListener("pointermove", onMove);
          root.addEventListener("pointerleave", onLeave);
          return () => {
            root.removeEventListener("pointermove", onMove);
            root.removeEventListener("pointerleave", onLeave);
          };
        },
      );

      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <section
      ref={rootRef}
      className="relative isolate z-20 grid min-h-svh place-items-center overflow-hidden bg-[#1a1f12] px-5 pb-8 pt-24 sm:px-8 sm:pb-10 sm:pt-28"
      id="top"
      aria-labelledby="ed-hero-title"
    >
      <Image
        data-ed-bg
        className="z-[-3] object-cover will-change-transform"
        src="/assets/section1-bg.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
      />
      <div
        className="pointer-events-none absolute inset-0 z-[-2] bg-[radial-gradient(48%_56%_at_50%_47%,rgba(16,20,9,0.5),rgba(16,20,9,0.05)_76%),linear-gradient(to_bottom,rgba(16,20,9,0.5),transparent_22%,transparent_60%,rgba(16,20,9,0.6))]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 z-[-1]"
        aria-hidden="true"
      >
        <div className="absolute left-0 top-1/2 origin-left -translate-y-[46%] max-lg:-translate-y-[58%] max-lg:scale-90 max-[620px]:opacity-70">
          <Image
            data-ed-hand-left
            className="block h-auto w-[min(46vw,600px)] will-change-transform [filter:drop-shadow(0_26px_40px_rgba(0,0,0,0.45))] max-lg:w-[62vw] max-[620px]:w-[76vw]"
            src="/assets/left-hand.png"
            alt=""
            width={550}
            height={550}
            priority
          />
        </div>
        <div className="absolute right-0 top-1/2 origin-right -translate-y-[40%] max-lg:-translate-y-[16%] max-lg:scale-90 max-[620px]:opacity-70">
          <Image
            data-ed-hand-right
            className="block h-auto w-[min(46vw,600px)] will-change-transform [filter:drop-shadow(0_26px_40px_rgba(0,0,0,0.45))] max-lg:w-[62vw] max-[620px]:w-[76vw]"
            src="/assets/right-hand.png"
            alt=""
            width={550}
            height={550}
            priority
          />
        </div>
      </div>

      <div
        data-ed-hero-frame
        className="relative flex min-h-[clamp(500px,72svh,640px)] w-full max-w-[480px] bg-[radial-gradient(115%_90%_at_50%_45%,rgba(14,18,8,0.62),rgba(14,18,8,0.12)_100%)] px-6 py-7 text-ed-cream [text-shadow:0_1px_18px_rgba(0,0,0,0.45)] sm:px-9 sm:py-9 lg:px-10 lg:py-11"
      >
        <svg
          data-ed-frame
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 340 452"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            x="0.5"
            y="0.5"
            width="339"
            height="451"
            pathLength={1}
            strokeDasharray={1}
            className="fill-none stroke-ed-cream/50"
          />
        </svg>
        <div data-ed-hero-inner className="relative flex w-full flex-col">
          <h1
            className="m-0 mt-2 flex flex-col text-[clamp(2.1rem,8vw,4.8rem)] font-medium leading-[0.92] tracking-[-0.02em] text-ed-cream sm:mt-4 sm:text-[clamp(2.1rem,4.4vw,4.8rem)]"
            id="ed-hero-title"
          >
            <span>Private</span>
            <span>USDC</span>
            <span>Payments</span>
          </h1>
          <p className="mt-6 max-w-[29ch] text-sm uppercase leading-[1.55] tracking-[0.08em] text-ed-cream/70">
            Get paid in USDC without publishing your income.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-7">
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ed-cream bg-ed-cream px-3 text-center text-sm font-semibold tracking-[0.02em] text-[#1a1f12] transition-opacity hover:opacity-85 sm:px-5"
              onClick={() => setWalletModalOpen(true)}
            >
              Try Now
            </button>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ed-cream/50 bg-transparent px-3 text-center text-sm font-semibold leading-tight tracking-[0.02em] text-ed-cream transition-opacity hover:opacity-85 sm:px-5"
              href="#steps"
            >
              How It Works
            </a>
          </div>
          <ul className="mt-auto grid list-none gap-0.5 pt-5 sm:pt-6">
            {MENU.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  data-ed-navlink={item.id}
                  className="flex items-baseline justify-between gap-2.5 border-b border-transparent py-2 text-[15px] font-semibold text-ed-cream/[0.66] transition-colors hover:border-ed-line hover:text-ed-cream data-[active=true]:border-ed-line data-[active=true]:text-ed-cream sm:py-2.5 sm:text-[17px]"
                >
                  <span>{item.label}</span>
                  <span className="text-[13px] font-medium tracking-[0.08em] text-ed-cream/55">
                    {item.numeral}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <StellarWalletModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </section>
  );
}
