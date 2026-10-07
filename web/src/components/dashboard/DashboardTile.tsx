import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Card } from "../ui/card";

export function DashboardTile({
  appearance,
  header,
  content,
  footer,
  className,
  compactOnMobile = false,
}: {
  appearance: "linen" | "glass" | "hero";
  header?: ReactNode;
  content?: ReactNode;
  footer?: ReactNode;
  className?: string;
  // Below md the tile shrinks to a half-width shortcut: header and content
  // stay, the footer hides (Figma "Overview - Mobile" action cards).
  compactOnMobile?: boolean;
}) {
  return (
    <Card
      appearance={appearance}
      className={cn(
        "dashboard-tile h-full gap-0 rounded-[1.75rem] p-6 md:min-h-68",
        compactOnMobile &&
          "max-md:min-h-[9.375rem] max-md:justify-between max-md:p-4",
        className,
      )}
    >
      {header ? (
        <div
          data-slot="tile-header"
          className={cn(compactOnMobile && "max-md:flex max-md:flex-1 max-md:flex-col")}
        >
          {header}
        </div>
      ) : null}
      {content ? <div data-slot="tile-content">{content}</div> : null}
      {footer ? (
        <div
          data-slot="tile-footer"
          className={cn("mt-auto pt-5", compactOnMobile && "max-md:hidden")}
        >
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
