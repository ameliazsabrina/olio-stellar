"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useVerification } from "../../features/verification/useVerification";
import { trpc } from "../../trpc/react";
import { Button } from "../ui/button";
import type { IdentityBadgeState } from "./IdentityVerificationBadge";
import {
  DETAIL_OPTIONS,
  PassportDownloadDialog,
  PERIOD_OPTIONS,
} from "./PassportDownloadDialog";
import { SettingsRow } from "./SettingsRow";
import { formatDate } from "./verificationCopy";

export function badgeStateFor(
  credential: { status: "active" | "suspended" | "expired" } | null | undefined,
): IdentityBadgeState {
  if (!credential) return "none";
  if (credential.status === "active") return "verified";
  return credential.status;
}

/**
 * The Track Record section of Settings: the payment statement PDF once
 * identity verification is approved.
 */
export function PassportTiles() {
  const { business, businessesLoading } = useVerification();
  const businessId = business?.businessId ?? null;
  const identity = trpc.passport.identity.useQuery(
    { businessId: businessId ?? "" },
    { enabled: businessId !== null },
  );

  if (businessesLoading || (businessId && identity.isLoading)) return null;

  const badgeState = badgeStateFor(identity.data?.credential);
  if (businessId && badgeState === "verified") {
    return <PassportStatementsRow businessId={businessId} />;
  }

  return (
    <p className="py-5 text-sm leading-6 text-muted-foreground">
      Your payment statement becomes available once identity verification is
      approved.
    </p>
  );
}

const DETAIL_LABEL = Object.fromEntries(DETAIL_OPTIONS);
const PERIOD_LABEL = Object.fromEntries(PERIOD_OPTIONS);
const STATUS_LABEL = {
  valid: "Valid",
  revoked: "Revoked",
  expired: "Expired",
} as const;

/**
 * The payment statement: download it as a PDF and revoke copies
 * already shared. Statement rows are never stored, so the list shows totals.
 */
function PassportStatementsRow({ businessId }: { businessId: string }) {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const statements = trpc.passport.listStatements.useQuery({ businessId });
  const revoke = trpc.passport.revokeStatement.useMutation({
    onSuccess: () => utils.passport.listStatements.invalidate({ businessId }),
  });

  async function revokeStatement(statementId: string) {
    try {
      await revoke.mutateAsync({ businessId, statementId });
      setConfirming(null);
      toast.success("Statement revoked");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The statement could not be revoked.",
      );
    }
  }

  const items = statements.data ?? [];

  return (
    <>
      <SettingsRow
        title="Payment statement"
        description="A PDF with your verified identity and the payments you received, as a monthly summary or a full list. Only people you send this file to will see your payment history. Anyone holding it can check it with Olio through the link printed on it."
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Download className="size-4" aria-hidden="true" />
            Download
          </Button>
        }
      >
        {items.length > 0 ? (
          <ul
            className="mb-4 divide-y divide-border-subtle rounded-2xl border border-border-subtle px-4 text-sm leading-6"
            aria-label="Issued statements"
          >
            {items.map((item) => (
              <li
                key={item.statementId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                data-testid="passport-statement"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {DETAIL_LABEL[item.detail]} ·{" "}
                    {PERIOD_LABEL[item.period.preset]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Issued {formatDate(item.issuedAt)} ·{" "}
                    {item.status === "valid"
                      ? `valid until ${formatDate(item.expiresAt)}`
                      : STATUS_LABEL[item.status].toLowerCase()}{" "}
                    · <span className="font-mono">{item.statementId}</span>
                  </p>
                </div>
                {item.status === "valid" ? (
                  confirming === item.statementId ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => revokeStatement(item.statementId)}
                        disabled={revoke.isPending}
                        aria-busy={revoke.isPending}
                      >
                        Confirm revoke
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirming(item.statementId)}
                      aria-label={`Revoke statement ${item.statementId}`}
                    >
                      Revoke
                    </Button>
                  )
                ) : (
                  <span className="rounded-full bg-foreground/8 px-2.5 py-0.5 text-xs text-muted-foreground">
                    {STATUS_LABEL[item.status]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          Revoking a statement makes its verify link report it as revoked.
          Copies already sent still exist, but anyone who checks will see it is
          no longer valid.
        </p>
      </SettingsRow>
      <PassportDownloadDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        businessId={businessId}
      />
    </>
  );
}
