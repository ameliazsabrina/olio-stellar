"use client";

import { ArrowDownLeft, ArrowUpRight, LockKeyhole } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { useMyNotes } from "./useMyNotes";

export function HistoryDashboard() {
  const { address, accountUnlocked, promptUnlock } = useWallet();
  const { notes, loading, error, refresh } = useMyNotes(
    accountUnlocked ? address : undefined,
  );
  const receivedCount = notes.length;
  const cashedOutCount = notes.filter((note) => note.spent).length;

  return (
    <>
      <DashboardPageHeader
        title="History"
        description={
          <>Review private payments received and cash-outs from this account.</>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)] lg:gap-6">
        <div className="min-w-0">
          {!accountUnlocked ? (
            <LockedHistory onUnlock={promptUnlock} />
          ) : error ? (
            <ToastFeedback
              title="Could not load history"
              message={error}
              variant="error"
              toastId="history-load-error"
              action={{ label: "Try again", onClick: refresh }}
            />
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
    </>
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
    <Card appearance="glass" density="comfortable" className="gap-4">
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
    <Card
      appearance="glass"
      density="comfortable"
      className="items-start gap-4"
    >
      <div className="flex size-11 items-center justify-center rounded-lg bg-white/12 text-white ring-1 ring-white/25">
        <LockKeyhole className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="type-product-panel-title text-white">
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
