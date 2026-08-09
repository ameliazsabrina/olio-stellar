import type * as React from "react";

import { cn } from "@/lib/utils";
import { glassPanelClass } from "./glass";

function Card({
  className,
  size = "default",
  density,
  appearance = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  density?: "compact" | "default" | "comfortable" | "spacious";
  appearance?: "default" | "glass";
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-density={density ?? (size === "sm" ? "compact" : "default")}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-2xl bg-card/90 p-(--card-spacing) text-sm text-card-foreground shadow-sm ring-1 ring-border/70 backdrop-blur-md [--card-spacing:--spacing(4)] has-[>img:first-child]:pt-0 data-[density=compact]:[--card-spacing:--spacing(3)] data-[density=comfortable]:[--card-spacing:--spacing(5)] data-[density=spacious]:[--card-spacing:--spacing(6)] *:[img:first-child]:rounded-t-2xl *:[img:last-child]:rounded-b-2xl",
        appearance === "glass" && glassPanelClass,
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-2xl has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-semibold tracking-tight group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-2xl border-t border-border/70 bg-muted/45 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
