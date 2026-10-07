import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Card } from "../ui/card";

export function DashboardTile({
  appearance,
  header,
  content,
  footer,
  className,
}: {
  appearance: "linen" | "glass" | "hero";
  header?: ReactNode;
  content?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      appearance={appearance}
      className={cn(
        "dashboard-tile h-full min-h-68 gap-0 rounded-[1.75rem] p-6",
        className,
      )}
    >
      {header ? <div data-slot="tile-header">{header}</div> : null}
      {content ? <div data-slot="tile-content">{content}</div> : null}
      {footer ? (
        <div data-slot="tile-footer" className="mt-auto pt-5">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
