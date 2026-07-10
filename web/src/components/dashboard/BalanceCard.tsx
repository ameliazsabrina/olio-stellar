"use client";

import { Send, ShieldCheck } from "lucide-react";
import { fromBaseUnits } from "../../lib/crypto";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

function formatUsd(units: bigint): string {
  const amount = Number(fromBaseUnits(units));
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function BalanceCard({
  claimable,
  loading,
  onSend,
}: {
  claimable: bigint;
  loading: boolean;
  onSend?: () => void;
}) {
  const hasNotes = claimable > 0n;

  return (
    <Card className="gap-0 overflow-hidden border-olive/30 bg-panel p-0 ring-2 ring-olive/25">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-1.5 text-sm text-muted-text">
          <span>Your Private Balance</span>
          <ShieldCheck className="size-4 text-olive" aria-hidden="true" />
        </div>

        <div className="font-heading text-4xl font-semibold tracking-tight text-ink">
          {loading ? (
            <span className="inline-block h-9 w-32 animate-pulse rounded bg-line/60 align-middle" />
          ) : (
            formatUsd(claimable)
          )}
        </div>

        {!loading && (
          <div className="text-xs text-muted-text">Tokens</div>
        )}

        {!loading && hasNotes && (
          <div className="flex items-center justify-between rounded-lg border border-line bg-white/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-sage text-sm font-semibold text-olive-deep">
                $
              </div>
              <div>
                <div className="text-sm font-medium text-ink">
                  {fromBaseUnits(claimable)} USDC
                </div>
                <div className="text-xs text-muted-text">Shielded pool</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={onSend}
              disabled={!onSend}
              title="Send privately"
              aria-label="Send privately"
            >
              <Send className="size-4" aria-hidden="true" />
              Send
            </Button>
          </div>
        )}

        {!loading && !hasNotes && (
          <p className="text-sm text-muted-text">
            No notes yet — share your link below to get paid privately.
          </p>
        )}
      </div>
      <div className="border-t border-olive/20 bg-sage/60 px-6 py-2.5 text-center text-xs font-medium text-olive-deep">
        Payments received privately through Olio
      </div>
    </Card>
  );
}
