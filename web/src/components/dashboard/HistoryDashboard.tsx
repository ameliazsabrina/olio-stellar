"use client";

import { ArrowDownLeft, ArrowUpRight, LockKeyhole } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { DashboardShell } from "./DashboardShell";
import { useMyNotes } from "./useMyNotes";

export function HistoryDashboard() {
  const { address, accountUnlocked, promptUnlock } = useWallet();
  const { notes, loading, error, refresh } = useMyNotes(
    accountUnlocked ? address : undefined,
  );
  const receivedCount = notes.length;
  const cashedOutCount = notes.filter((note) => note.spent).length;

  return (
    <DashboardShell navigation showBack>
      <div className="mb-7">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-white sm:text-5xl">
          History
        </h1>
        <p className="mt-2 max-w-2xl text-sm font-medium text-white/70 sm:text-base">
          Review private payments received and cash-outs from this account.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)] lg:gap-6">
        <div className="min-w-0">
          {!accountUnlocked ? (
            <LockedHistory onUnlock={promptUnlock} />
          ) : error ? (
            <Alert appearance="glass" variant="destructive">
              <AlertTitle>Could not load history</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button
                  type="button"
                  variant="glass"
                  size="sm"
                  onClick={refresh}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <ActivityFeed
              notes={notes}
              loading={loading}
              title="All activity"
              showExport
            />
          )}
        </div>

        <aside
          className="grid gap-4 lg:sticky lg:top-6"
          aria-label="History summary"
        >
          <SummaryCard
            label="Payments received"
            value={accountUnlocked && !loading ? receivedCount : null}
            icon={ArrowDownLeft}
          />
          <SummaryCard
            label="Payments cashed out"
            value={accountUnlocked && !loading ? cashedOutCount : null}
            icon={ArrowUpRight}
          />
        </aside>
      </div>
    </DashboardShell>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  icon: typeof ArrowDownLeft;
}) {
  return (
    <Card appearance="glass" className="gap-4 p-5">
      <div className="flex size-11 items-center justify-center rounded-lg bg-white/12 text-white ring-1 ring-white/25">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-white/65">{label}</p>
        <p className="mt-1 font-mono text-3xl font-semibold tracking-tight text-white tabular-nums">
          {value ?? "—"}
        </p>
      </div>
    </Card>
  );
}

function LockedHistory({ onUnlock }: { onUnlock: () => void }) {
  return (
    <Card appearance="glass" className="items-start gap-4 p-5 sm:p-6">
      <div className="flex size-11 items-center justify-center rounded-lg bg-white/12 text-white ring-1 ring-white/25">
        <LockKeyhole className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-white">
          Unlock to view history
        </h2>
        <p className="text-sm text-white/65">
          Your PIN unlocks the private payment records stored on this device.
        </p>
      </div>
      <Button variant="glass" size="lg" onClick={onUnlock}>
        Unlock with PIN
      </Button>
    </Card>
  );
}
