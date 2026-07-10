"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const MENU = [
  { id: "links", numeral: "I", label: "What's Olio?" },
  { id: "shield", numeral: "II", label: "Shielded pool" },
  { id: "withdraw", numeral: "III", label: "Withdrawals" },
  { id: "start", numeral: "IV", label: "Get started" },
];

export function Hero() {
  const rootRef = useRef<HTMLElement | null>(null);

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

          // Entrance: frame draws and content rises. Hand artwork stays static.
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

          const mapX = gsap.utils.mapRange(0, root.clientWidth, -1, 1);
          const mapY = gsap.utils.mapRange(0, root.clientHeight, -1, 1);
          const clamp = gsap.utils.clamp(-1, 1);

          const onMove = (e: PointerEvent) => {
            const rect = root.getBoundingClientRect();
            const nx = clamp(mapX(e.clientX - rect.left));
            const ny = clamp(mapY(e.clientY - rect.top));
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
      className="relative isolate z-20 grid min-h-svh place-items-center overflow-hidden bg-[#1a1f12]"
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
        className="relative flex w-[min(440px,calc(100vw-40px))] px-9 py-10 text-ed-cream [text-shadow:0_1px_18px_rgba(0,0,0,0.45)] aspect-[340/452] bg-[radial-gradient(115%_90%_at_50%_45%,rgba(14,18,8,0.62),rgba(14,18,8,0.12)_100%)] max-[620px]:aspect-auto max-[620px]:min-h-[60svh] max-[620px]:px-6 max-[620px]:py-[30px]"
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
            className="m-0 mt-4 flex flex-col font-medium text-[clamp(1.8rem,4vw,4.4rem)] leading-[0.92] tracking-[-0.02em] text-ed-cream"
            id="ed-hero-title"
          >
            <span>Private</span>
            <span>USDC</span>
            <span>Payments</span>
          </h1>
          <p className="mt-5 max-w-[28ch] text-[13px] uppercase leading-[1.5] tracking-[0.08em] text-ed-cream/70">
            Get paid in USDC without publishing your income.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <a
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-ed-cream bg-ed-cream px-[18px] text-[13px] font-semibold tracking-[0.02em] text-[#1a1f12] transition-opacity hover:opacity-85"
              href="#start"
            >
              Try Now
            </a>
            <a
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-ed-cream/50 bg-transparent px-[18px] text-[13px] font-semibold tracking-[0.02em] text-ed-cream transition-opacity hover:opacity-85"
              href="#shield"
            >
              See How It Works
            </a>
          </div>
          <ul className="mt-auto grid gap-0.5 pt-6 list-none">
            {MENU.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  data-ed-navlink={item.id}
                  className="flex items-baseline justify-between gap-2.5 border-b border-transparent py-2 text-base font-semibold text-ed-cream/[0.66] transition-colors hover:border-ed-line hover:text-ed-cream data-[active=true]:border-ed-line data-[active=true]:text-ed-cream"
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
    </section>
  );
}
