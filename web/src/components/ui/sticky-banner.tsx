"use client";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from "motion/react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export const StickyBanner = ({
  className,
  children,
  hideOnScroll = false,
  ...props
}: Omit<React.ComponentProps<typeof motion.div>, "children"> & {
  children: React.ReactNode;
  hideOnScroll?: boolean;
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [hiddenOnScroll, setHiddenOnScroll] = useState(false);
  const { scrollY } = useScroll();
  const open = !dismissed && !hiddenOnScroll;

  useMotionValueEvent(scrollY, "change", (latest) => {
    setHiddenOnScroll(hideOnScroll && latest > 40);
  });

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          {...props}
          className={cn(
            "sticky inset-x-0 top-0 z-40 flex min-h-14 w-full items-center justify-center bg-transparent px-4 py-1",
            className,
          )}
          data-state="open"
          initial={{
            y: -100,
            opacity: 0,
          }}
          animate={{
            y: 0,
            opacity: 1,
          }}
          exit={{
            y: -100,
            opacity: 0,
          }}
          transition={{
            duration: 0.3,
            ease: "easeInOut",
          }}
        >
          {children}

          <motion.button
            type="button"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-ed-cream transition-colors hover:bg-ed-cream/10 focus-visible:ring-2 focus-visible:ring-ed-cream/60"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss announcement"
          >
            <CloseIcon className="size-4" />
          </motion.button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
