import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type LandingSectionProps = Omit<ComponentProps<"section">, "children"> & {
  children: ReactNode;
  tone?: "paper" | "dark" | "transparent";
  spacing?: "default" | "compact" | "none";
  fullHeight?: boolean;
  container?: "6xl" | "7xl" | "none";
  containerClassName?: string;
};

export function LandingSection({
  children,
  className,
  tone = "paper",
  spacing = "default",
  fullHeight = false,
  container = "7xl",
  containerClassName,
  ...props
}: LandingSectionProps) {
  return (
    <section
      className={cn(
        "relative z-20 px-(--page-gutter)",
        tone === "paper" && "bg-paper text-ink",
        tone === "dark" && "bg-ed-dark text-ed-cream",
        spacing === "default" && "py-(--section-space)",
        spacing === "compact" && "py-(--section-space-compact)",
        fullHeight && "flex min-h-svh items-center",
        className,
      )}
      {...props}
    >
      {container === "none" ? (
        children
      ) : (
        <div
          className={cn(
            "mx-auto w-full",
            container === "6xl" ? "max-w-6xl" : "max-w-7xl",
            containerClassName,
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
