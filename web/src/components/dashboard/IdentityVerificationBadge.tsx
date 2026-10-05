import { BadgeCheck } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatDate } from "./verificationCopy";

export type IdentityBadgeState = "verified" | "suspended" | "expired" | "none";

export function IdentityVerificationBadge({
  state,
  displayName,
  type,
  checkedAt,
  validUntil,
  policyVersion,
  className,
  compact = false,
}: {
  state: IdentityBadgeState;
  displayName: string | null;
  type: "individual" | "company";
  checkedAt: string | null;
  validUntil: string | null;
  policyVersion: number | null;
  className?: string;
  compact?: boolean;
}) {
  const verified = state === "verified";
  const subject = type === "company" ? "Company" : "Individual";
  const title = verified
    ? "Identity Verified"
    : state === "suspended"
      ? "Verification suspended"
      : state === "expired"
        ? "Verification expired"
        : "Not verified";

  return (
    <div
      data-testid="identity-badge"
      data-state={state}
      className={cn(
        "flex flex-col gap-3 rounded-[1.5rem] p-5 ring-1",
        verified
          ? "bg-brand-linen text-brand-obsidian ring-brand-obsidian/10"
          : "bg-brand-linen/8 text-brand-linen ring-brand-linen/15",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {verified ? (
          <BadgeCheck className="size-6 shrink-0" aria-hidden="true" />
        ) : null}
        <div className="min-w-0">
          <p className="font-heading text-xl font-semibold tracking-tight">
            {title}
          </p>
          <p
            className={cn(
              "truncate text-sm",
              verified ? "text-brand-obsidian/70" : "text-brand-linen/70",
            )}
          >
            {displayName ?? "Unnamed profile"} · {subject}
          </p>
        </div>
      </div>
      {!compact ? (
        <dl
          className={cn(
            "grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3",
            verified ? "text-brand-obsidian/70" : "text-brand-linen/60",
          )}
        >
          <div>
            <dt>Issued by</dt>
            <dd className="font-medium">Olio</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd className="font-medium">Identity only</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd className="font-medium">v{policyVersion ?? "—"}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd className="font-medium">{formatDate(checkedAt)}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd className="font-medium">{formatDate(validUntil)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
