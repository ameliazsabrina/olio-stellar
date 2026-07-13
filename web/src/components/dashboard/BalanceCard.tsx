"use client";

import {
  ArrowDownToLine,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
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
  locked = false,
  onUnlock,
  onWithdraw,
  onReceive,
}: {
  claimable: bigint;
  loading: boolean;
  locked?: boolean;
  onUnlock?: () => void;
  onWithdraw?: () => void;
  onReceive?: () => void;
}) {
  if (locked) return <LockedBalanceCard onUnlock={onUnlock} />;

  const hasNotes = claimable > 0n;
  const noteState = loading
    ? "Scanning local notes"
    : hasNotes
      ? "Ready to cash out"
      : "Waiting for first payment";

  return (
    <Card className="gap-0 overflow-hidden border-olive/25 bg-panel p-0 ring-1 ring-olive/20">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_16rem]">
        <div className="flex min-w-0 flex-col justify-between gap-7">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-olive/20 bg-sage/60 px-2.5 py-1 text-xs font-medium text-olive-deep">
              <ShieldCheck className="size-3.5 text-olive" aria-hidden="true" />
              Shielded pool
            </div>
            <div className="rounded-full border border-line bg-paper/70 px-2.5 py-1 text-xs text-muted-text">
              {noteState}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm text-muted-text">Private balance</div>
            <div className="font-heading text-5xl font-semibold leading-none text-ink sm:text-6xl">
              {loading ? (
                <span className="inline-block h-12 w-40 animate-pulse rounded-lg bg-line/60 align-middle" />
              ) : (
                formatUsd(claimable)
              )}
            </div>
            <div className="text-sm text-muted-text">
              {loading
                ? "Decrypting notes stored for this passkey."
                : hasNotes
                  ? `${fromBaseUnits(claimable)} USDC available from discovered private notes.`
                  : "Create a request link or QR to receive your first private note."}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="lg"
              className="min-h-11 flex-1"
              onClick={onReceive}
              disabled={!onReceive || loading}
            >
              <QrCode className="size-4" aria-hidden="true" />
              Receive
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="min-h-11 flex-1"
              onClick={onWithdraw}
              disabled={!onWithdraw || !hasNotes || loading}
              title={
                hasNotes
                  ? "Cash out to a wallet"
                  : "Receive a payment before cashing out"
              }
            >
              <ArrowDownToLine className="size-4" aria-hidden="true" />
              Cash out
            </Button>
          </div>
        </div>

        <div className="grid content-between gap-3 rounded-lg border border-line bg-sage/35 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase text-muted-text">
                Note set
              </div>
              <div className="mt-1 text-sm font-medium text-ink">
                {hasNotes ? "Encrypted notes found" : "No spendable notes yet"}
              </div>
            </div>
            <WalletCards className="size-5 text-olive" aria-hidden="true" />
          </div>

          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-md bg-panel/80 px-3 py-2">
              <span className="text-muted-text">Asset</span>
              <span className="font-medium text-ink">USDC</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-panel/80 px-3 py-2">
              <span className="text-muted-text">Status</span>
              <span className="font-medium text-olive-deep">Private</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-panel/80 px-3 py-2">
              <span className="text-muted-text">Cash out</span>
              <span className="inline-flex items-center gap-1 font-medium text-ink">
                <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                To wallet
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-olive/15 bg-sage/45 px-5 py-2.5 text-xs font-medium text-olive-deep sm:px-6">
        Private by default. Proofs are generated locally before funds leave the
        pool.
      </div>
    </Card>
  );
}

// Shown when a session is restored on a device that doesn't hold the note
// secrets yet. The balance is unknowable until the master is unlocked, so we
// prompt for the PIN instead of rendering a misleading $0.
function LockedBalanceCard({ onUnlock }: { onUnlock?: () => void }) {
  return (
    <Card className="gap-0 overflow-hidden border-olive/25 bg-panel p-0 ring-1 ring-olive/20">
      <div className="grid gap-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-olive/20 bg-sage/60 px-2.5 py-1 text-xs font-medium text-olive-deep">
            <LockKeyhole className="size-3.5 text-olive" aria-hidden="true" />
            Locked on this device
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-sm text-muted-text">Private balance</div>
          <div className="font-heading text-4xl font-semibold leading-none text-ink sm:text-5xl">
            Unlock to view
          </div>
          <div className="max-w-md text-sm text-muted-text">
            Your account key isn't cached here. Enter your 6-digit PIN to restore
            it and reveal your balance — it never leaves this browser.
          </div>
        </div>

        <Button
          size="lg"
          className="min-h-11 w-fit"
          onClick={onUnlock}
          disabled={!onUnlock}
        >
          <LockKeyhole className="size-4" aria-hidden="true" />
          Unlock with PIN
        </Button>
      </div>
    </Card>
  );
}
