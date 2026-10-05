import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { glassFieldClass, linenFieldClass } from "./glass";

function Input({
  className,
  type,
  appearance = "default",
  ...props
}: React.ComponentProps<"input"> & {
  appearance?: "default" | "glass" | "linen";
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[41px] w-full min-w-0 rounded-lg border border-(--field-border) bg-(--control) px-3.5 py-2.5 text-base leading-[21px] md:text-sm text-(--control-foreground) transition-[background-color,border-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-(--control-muted) focus-visible:border-(--control-foreground) focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-(--status-danger-fg) aria-invalid:ring-2 aria-invalid:ring-destructive/25",
        appearance === "glass" && glassFieldClass,
        appearance === "linen" && linenFieldClass,
        className,
      )}
      {...props}
    />
  );
}

export { Input };
