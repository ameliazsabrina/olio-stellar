import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { glassButtonClass } from "./glass";

// Matches the Figma "Button" component: Primary (olive accent), Secondary
// (linen with a line border), Ghost (text only) and Inverse (linen, for dark
// surfaces). md is 41px tall, sm is 30px, both on the 12px control radius.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-(--action) text-(--action-foreground) hover:bg-[color-mix(in_oklab,var(--action),black_12%)]",
        secondary:
          "border-(--control-border) bg-(--control) text-(--control-foreground) hover:bg-[color-mix(in_oklab,var(--control),var(--control-foreground)_6%)] aria-expanded:bg-[color-mix(in_oklab,var(--control),var(--control-foreground)_6%)]",
        outline:
          "border-(--control-border) bg-(--control) text-(--control-foreground) hover:bg-[color-mix(in_oklab,var(--control),var(--control-foreground)_6%)] aria-expanded:bg-[color-mix(in_oklab,var(--control),var(--control-foreground)_6%)]",
        ghost:
          "text-(--control-muted) hover:bg-(--control) hover:text-(--control-foreground) aria-expanded:bg-(--control) aria-expanded:text-(--control-foreground)",
        inverse:
          "bg-(--inverse) text-(--inverse-foreground) hover:bg-[color-mix(in_oklab,var(--inverse),black_6%)]",
        destructive:
          "border-(--status-danger-border) bg-(--status-danger-bg) text-(--status-danger-fg) hover:bg-[color-mix(in_oklab,var(--status-danger-bg),var(--status-danger-fg)_8%)] focus-visible:ring-destructive/25",
        link: "text-(--action) underline-offset-4 hover:underline",
        glass: glassButtonClass,
      },
      size: {
        default:
          "h-[41px] gap-2 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        md: "h-[41px] gap-2 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        xs: "h-7 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[30px] gap-2 px-3 text-[13px] leading-[18px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-sm [&_svg:not([class*='size-'])]:size-4",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
