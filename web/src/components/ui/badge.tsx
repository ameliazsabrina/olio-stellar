import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Matches the Figma "Badge" component: a status pill with a leading dot in
// Neutral, Success, Warning, Danger and Muted tones. The dot is dropped when
// the badge already carries its own icon.
const neutralTone =
  "border-(--status-neutral-border) bg-(--status-neutral-bg) text-(--status-neutral-fg)";
const dangerTone =
  "border-(--status-danger-border) bg-(--status-danger-bg) text-(--status-danger-fg)";

const badgeVariants = cva(
  "group/badge inline-flex h-[21px] w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs leading-[17px] font-medium whitespace-nowrap transition-colors not-has-[svg]:before:size-1.5 not-has-[svg]:before:shrink-0 not-has-[svg]:before:rounded-full not-has-[svg]:before:bg-current not-has-[svg]:before:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: neutralTone,
        neutral: neutralTone,
        outline: neutralTone,
        secondary: neutralTone,
        success:
          "border-(--status-success-border) bg-(--status-success-bg) text-(--status-success-fg)",
        warning:
          "border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)",
        danger: dangerTone,
        destructive: dangerTone,
        muted:
          "border-(--status-muted-border) bg-(--status-muted-bg) text-(--status-muted-fg)",
        ghost:
          "border-transparent text-(--status-neutral-fg) hover:bg-(--status-neutral-bg)",
        link: "border-transparent text-(--action) underline-offset-4 before:hidden hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  appearance = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    appearance?: "default" | "glass";
  }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          badgeVariants({ variant }),
          appearance === "glass" && "border-white/15 bg-white/8 text-white/70",
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
