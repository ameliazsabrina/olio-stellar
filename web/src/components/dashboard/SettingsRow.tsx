import { type ReactNode, useId } from "react";
import { cn } from "../../lib/utils";

/**
 * One line of a settings panel: title and explanation on the left, the
 * control on the right, optional detail underneath. Rows divide themselves.
 */
export function SettingsRow({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = useId();

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 scroll-mt-6 border-b border-border-subtle py-5",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 max-w-xl">
          <h3
            id={headingId}
            className="font-heading text-[0.9375rem] font-semibold leading-6 tracking-tight text-foreground"
          >
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
            {action}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-4 min-w-0">{children}</div> : null}
    </section>
  );
}
