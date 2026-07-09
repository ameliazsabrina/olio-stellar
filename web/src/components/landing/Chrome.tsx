"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { type ReactNode, useRef } from "react";
import { EditionsTopNav } from "./Nav";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const CIRCLES: { cx: number; cy: number; r: number; g: string; rot: number }[] =
  [
    { cx: 0, cy: 543.9, r: 550, g: "1,3", rot: 0 },
    { cx: 1440, cy: 543.9, r: 550, g: "1,3", rot: 180 },
    { cx: 2.5, cy: -365, r: 805, g: "2", rot: -45 },
    { cx: 1437.5, cy: -365, r: 805, g: "2", rot: -45 },
    { cx: 2.5, cy: 1245, r: 805, g: "2,4", rot: 45 },
    { cx: 1437.5, cy: 1245, r: 805, g: "2,4", rot: 45 },
    { cx: 720, cy: 15, r: 425, g: "3,4", rot: -45 },
    { cx: 720, cy: 865, r: 425, g: "1,3,4", rot: 45 },
    { cx: 720, cy: -365, r: 805, g: "3", rot: -45 },
    { cx: 720, cy: 1245, r: 805, g: "3", rot: 45 },
    { cx: 1535.8, cy: 858.7, r: 917, g: "1,4", rot: 45 },
    { cx: -95.8, cy: 858.7, r: 917, g: "1,4", rot: 45 },
    { cx: 1535.8, cy: 21.3, r: 917, g: "2,4", rot: -45 },
    { cx: -95.8, cy: 21.3, r: 917, g: "4", rot: -45 },
  ];

export function EditionsChrome({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;

      const circles = gsap.utils.toArray<SVGCircleElement>(
        "[data-ed-canvas] circle",
        root,
      );
      const navLinks = gsap.utils.toArray<HTMLElement>(
        "[data-ed-navlink]",
        root,
      );
      const sections = gsap.utils.toArray<HTMLElement>(
        "[data-ed-section]",
        root,
      );
      const topnav = root.querySelector<HTMLElement>("[data-ed-topnav]");

      const mm = gsap.matchMedia(root);
      mm.add(
        { reduceMotion: "(prefers-reduced-motion: reduce)" },
        (context) => {
          const { reduceMotion } = context.conditions as {
            reduceMotion: boolean;
          };

          // ---- Lenis smooth scroll (skipped under reduced motion) ----
          let lenis: Lenis | undefined;
          let raf: ((t: number) => void) | undefined;
          if (!reduceMotion) {
            lenis = new Lenis();
            lenis.on("scroll", ScrollTrigger.update);
            raf = (t: number) => lenis!.raf(t * 1000);
            gsap.ticker.add(raf);
            gsap.ticker.lagSmoothing(0);
          }

          // ---- Top nav: solid/blurred once scrolled ~40px past the top ----
          if (topnav) {
            ScrollTrigger.create({
              start: 40,
              onEnter: () => (topnav.dataset.scrolled = "true"),
              onLeaveBack: () => (topnav.dataset.scrolled = "false"),
            });
          }

          // ---- Per-section circle activation + nav highlight ----
          let activeGroup = 0;
          const activate = (group: number) => {
            if (group === activeGroup) return;
            activeGroup = group;
            let onIndex = 0;
            circles.forEach((circle) => {
              const on = (circle.dataset.group ?? "")
                .split(",")
                .includes(String(group));
              gsap.to(circle, {
                strokeDashoffset: on ? 0 : 1,
                duration: reduceMotion ? 0 : 1.6,
                delay: reduceMotion || !on ? 0 : 0.09 * onIndex++,
                ease: "power2.inOut",
                overwrite: "auto",
              });
            });
          };

          sections.forEach((section, i) => {
            ScrollTrigger.create({
              trigger: section,
              start: "top 55%",
              end: "bottom 55%",
              onToggle: (self) => {
                if (!self.isActive) return;
                activate(i + 1);
                navLinks.forEach(
                  (link) =>
                    (link.dataset.active = String(
                      link.dataset.edNavlink === section.id,
                    )),
                );
              },
            });

            if (reduceMotion) return;

            const headline = section.querySelector("[data-ed-headline]");
            const narrative = section.querySelector("[data-ed-narrative]");
            gsap.from([headline, narrative], {
              autoAlpha: 0,
              y: 56,
              duration: 1.1,
              stagger: 0.16,
              ease: "power3.out",
              scrollTrigger: { trigger: section, start: "top 72%" },
            });
            gsap.to(headline, {
              yPercent: -16,
              ease: "none",
              scrollTrigger: {
                trigger: section,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
              },
            });
          });

          if (!reduceMotion) {
            gsap.set("[data-ed-article]", { autoAlpha: 0, y: 44 });
            ScrollTrigger.batch("[data-ed-article]", {
              start: "top 88%",
              once: true,
              onEnter: (batch) =>
                gsap.to(batch, {
                  autoAlpha: 1,
                  y: 0,
                  duration: 0.9,
                  stagger: 0.12,
                  ease: "power3.out",
                  overwrite: true,
                }),
            });
          }

          return () => {
            if (raf) gsap.ticker.remove(raf);
            lenis?.destroy();
          };
        },
      );

      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      data-side="dark"
      className="isolate relative min-h-svh bg-ed-dark text-ed-cream before:pointer-events-none before:fixed before:inset-0 before:z-0 before:content-[''] before:[background:radial-gradient(120%_90%_at_78%_12%,rgba(183,138,52,0.12),transparent_60%),radial-gradient(90%_80%_at_10%_100%,rgba(0,0,0,0.5),transparent_65%)]"
    >
      <div
        className="pointer-events-none fixed inset-0 z-0"
        data-ed-canvas
        aria-hidden="true"
      >
        <svg
          className="block h-full w-full"
          viewBox="0 0 1440 880"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          {CIRCLES.map((c, i) => (
            <circle
              key={i}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              vectorEffect="non-scaling-stroke"
              data-group={c.g}
              transform={`rotate(${c.rot} ${c.cx} ${c.cy})`}
              className="fill-none stroke-ed-cream stroke-[0.5px] opacity-50"
            />
          ))}
        </svg>
      </div>

      <EditionsTopNav />

      {children}
    </div>
  );
}
