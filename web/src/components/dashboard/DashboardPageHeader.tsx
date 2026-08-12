import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DashboardPageHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-7 flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="type-product-page-title text-brand-linen">{title}</h1>
        <p className="type-supporting mt-2 max-w-2xl text-brand-linen/70 sm:text-base">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
