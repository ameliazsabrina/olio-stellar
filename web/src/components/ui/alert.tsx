import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-1 rounded-lg border px-3 py-2.5 text-left text-sm shadow-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border/70 bg-card/80 text-card-foreground",
        destructive:
          "border-destructive/35 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
        success: "border-ok/35 bg-ok/10 text-ok *:[svg]:text-current",
        info: "border-border/70 bg-secondary/75 text-secondary-foreground *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  appearance = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    appearance?: "default" | "glass";
  }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        alertVariants({ variant }),
        appearance === "glass" &&
          "border-white/15 bg-white/8 text-white shadow-none backdrop-blur-md [&_[data-slot=alert-description]]:text-white/70",
        appearance === "glass" &&
          variant === "destructive" &&
          "border-err/45 bg-err/15 text-red-100 [&_[data-slot=alert-description]]:text-red-100/85",
        appearance === "glass" &&
          variant === "success" &&
          "border-ok/45 bg-ok/15 text-emerald-100 [&_[data-slot=alert-description]]:text-emerald-100/85",
        className,
      )}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
