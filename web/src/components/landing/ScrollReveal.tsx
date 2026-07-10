"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

gsap.registerPlugin(ScrollTrigger);

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function splitTextNode(text: string, keyPrefix: string) {
  const seen = new Map<string, number>();
  const parts: ReactNode[] = [];
  let offset = 0;

  for (const word of text.split(/(\s+)/)) {
    const wordOffset = offset;
    offset += word.length;

    if (/^\s+$/.test(word)) {
      parts.push(word);
      continue;
    }

    const count = seen.get(word) ?? 0;
    seen.set(word, count + 1);

    parts.push(
      <span
        className="inline-block word"
        key={`${keyPrefix}-${word}-${count}-${wordOffset}`}
      >
        {word}
      </span>,
    );
  }

  return parts;
}

function splitRevealChildren(
  children: ReactNode,
  keyPrefix = "reveal",
): ReactNode {
  if (typeof children === "string" || typeof children === "number") {
    return splitTextNode(String(children), keyPrefix);
  }

  return Children.toArray(children).map((child, index) => {
    const childKey = `${keyPrefix}-${index}`;

    if (typeof child === "string" || typeof child === "number") {
      return splitTextNode(String(child), childKey);
    }

    if (isValidElement<{ children?: ReactNode }>(child)) {
      return cloneElement(child, {
        ...child.props,
        key: child.key ?? childKey,
        children: splitRevealChildren(child.props.children, childKey),
      });
    }

    return child;
  });
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textFromChildren(child.props.children);
      }
      return "";
    })
    .join("");
}

interface ScrollRevealProps {
  children: ReactNode;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  enableBlur?: boolean;
  baseOpacity?: number;
  baseRotation?: number;
  blurStrength?: number;
  containerClassName?: string;
  textClassName?: string;
  rotationEnd?: string;
  wordAnimationEnd?: string;
}

export function ScrollReveal({
  children,
  scrollContainerRef,
  enableBlur = true,
  baseOpacity = 0.1,
  baseRotation = 3,
  blurStrength = 4,
  containerClassName = "",
  textClassName = "",
  rotationEnd = "bottom bottom",
  wordAnimationEnd = "bottom bottom",
}: ScrollRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const splitText = useMemo(() => splitRevealChildren(children), [children]);
  const plainText = useMemo(() => textFromChildren(children), [children]);

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ctx = gsap.context(() => {
      const scroller = scrollContainerRef?.current ?? window;
      const wordElements = el.querySelectorAll<HTMLElement>(".word");

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(el, { rotate: 0 });
        gsap.set(wordElements, { opacity: 1, filter: "blur(0px)" });
        return;
      }

      gsap.fromTo(
        el,
        { transformOrigin: "0% 50%", rotate: baseRotation },
        {
          ease: "none",
          rotate: 0,
          scrollTrigger: {
            trigger: el,
            scroller,
            start: "top bottom",
            end: rotationEnd,
            scrub: true,
          },
        },
      );

      gsap.fromTo(
        wordElements,
        { opacity: baseOpacity, willChange: "opacity" },
        {
          ease: "none",
          opacity: 1,
          stagger: 0.05,
          scrollTrigger: {
            trigger: el,
            scroller,
            start: "top bottom-=20%",
            end: wordAnimationEnd,
            scrub: true,
          },
        },
      );

      if (enableBlur) {
        gsap.fromTo(
          wordElements,
          { filter: `blur(${blurStrength}px)` },
          {
            ease: "none",
            filter: "blur(0px)",
            stagger: 0.05,
            scrollTrigger: {
              trigger: el,
              scroller,
              start: "top bottom-=20%",
              end: wordAnimationEnd,
              scrub: true,
            },
          },
        );
      }

      requestAnimationFrame(() => ScrollTrigger.refresh());
    }, el);

    return () => ctx.revert();
  }, [
    scrollContainerRef,
    enableBlur,
    baseRotation,
    baseOpacity,
    rotationEnd,
    wordAnimationEnd,
    blurStrength,
    plainText,
  ]);

  return (
    <div ref={containerRef} className={containerClassName}>
      <p className={textClassName}>{splitText}</p>
    </div>
  );
}
