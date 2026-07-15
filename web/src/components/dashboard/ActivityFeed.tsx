"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Download,
  FileCheck,
  ReceiptText,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import type { MyNote } from "../../lib/notes";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { DiscloseDialog } from "./DiscloseDialog";

type ActivityEvent = {
  id: string;
  kind: "incoming" | "outgoing";
  amount: bigint;
  leafIndex: number;
};

const TABS = ["All", "Received", "Cashed out"] as const;
type Tab = (typeof TABS)[number];

function toEvents(notes: MyNote[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const note of notes) {
    events.push({
      id: `${note.leafIndex}-in`,
      kind: "incoming",
      amount: note.amount,
      leafIndex: note.leafIndex,
    });
    if (note.spent) {
      events.push({
        id: `${note.leafIndex}-out`,
        kind: "outgoing",
        amount: note.amount,
        leafIndex: note.leafIndex,
      });
    }
  }
  return events.sort((a, b) => {
    if (a.leafIndex !== b.leafIndex) return b.leafIndex - a.leafIndex;
    return a.kind === "outgoing" ? -1 : 1;
  });
}

function exportCsv(events: ActivityEvent[]) {
  const header = "type,amount_usdc,note_index\n";
  const rows = events
    .map((e) => {
      const type = e.kind === "incoming" ? "received" : "cashed_out";
      return `${type},${fromBaseUnits(e.amount)},${e.leafIndex}`;
    })
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "olio-receipts.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ActivityFeed({
  notes,
  loading,
  limit,
  showSeeAll = false,
  showExport = false,
  title = "History",
  className,
}: {
  notes: MyNote[];
  loading: boolean;
  limit?: number;
  showSeeAll?: boolean;
  showExport?: boolean;
  title?: string;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("All");
  const [discloseLeaf, setDiscloseLeaf] = useState<number | null>(null);
  const events = useMemo(() => toEvents(notes), [notes]);
  const filtered = useMemo(() => {
    if (tab === "Received") return events.filter((e) => e.kind === "incoming");
    if (tab === "Cashed out")
      return events.filter((e) => e.kind === "outgoing");
    return events;
  }, [events, tab]);
  const displayed = limit === undefined ? filtered : filtered.slice(0, limit);
  const skeletonCount = limit ?? 5;
  const scrollable = limit === undefined && filtered.length > 5;

  return (
    <Card
      appearance="glass"
      id="activity"
      className={cn("gap-5 p-5 sm:p-6", className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold text-white">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <fieldset className="flex w-fit items-center gap-1 rounded-lg bg-white/7 p-1 ring-1 ring-white/12 backdrop-blur-md">
            <legend className="sr-only">Filter activity</legend>
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-10 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  tab === t
                    ? "bg-white/14 text-white shadow-sm shadow-ink/10"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      <section
        className={
          limit === undefined
            ? "max-h-80 overflow-y-auto overscroll-contain rounded-lg pr-1 focus-visible:ring-2 focus-visible:ring-white/70"
            : "rounded-lg"
        }
        tabIndex={!loading && scrollable ? 0 : undefined}
        aria-label="Activity history"
      >
        <ul className="flex flex-col divide-y divide-white/20">
          {loading && (
            <li className="grid gap-3 py-2" aria-label="Loading history">
              {Array.from({ length: skeletonCount }, (_, item) => item).map(
                (item) => (
                  <div
                    key={item}
                    className="h-16 rounded-lg bg-white/8 motion-safe:animate-pulse"
                  />
                ),
              )}
            </li>
          )}

          {!loading && filtered.length === 0 && (
            <li className="py-5 text-sm text-white/55">
              {tab === "Cashed out"
                ? "Nothing cashed out yet."
                : tab === "Received"
                  ? "No payments received yet."
                  : "No payments yet. Share your pay link to receive your first."}
            </li>
          )}

          {!loading &&
            displayed.map((event) => (
              <li
                key={event.id}
                className="flex min-h-16 items-center gap-3 py-3"
              >
                <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/14 text-white">
                  <ReceiptText className="size-5" aria-hidden="true" />
                  <span className="absolute -top-1 -left-1 flex size-5 items-center justify-center rounded-full bg-white text-ink ring-2 ring-ink/50">
                    {event.kind === "incoming" ? (
                      <ArrowDownLeft className="size-3" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                    )}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">
                    {event.kind === "incoming"
                      ? "Payment received"
                      : "Cashed out"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <Badge
                      appearance="glass"
                      variant="outline"
                      className="border-white/15 text-[10px] text-white/55"
                    >
                      private note
                    </Badge>
                    <span className="font-mono text-xs text-white/45">
                      #{event.leafIndex}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div
                    className={`text-right font-mono text-sm font-semibold ${
                      event.kind === "incoming"
                        ? "rounded-md bg-ok px-2 py-1 text-white ring-1 ring-white/20"
                        : "text-white"
                    }`}
                  >
                    {event.kind === "incoming" ? "+" : "−"}
                    {fromBaseUnits(event.amount)} USDC
                  </div>
                  {event.kind === "incoming" && (
                    <Button
                      variant="glass"
                      size="icon"
                      className="size-10 bg-white/18 text-white ring-white/35 hover:bg-white/25"
                      onClick={() => setDiscloseLeaf(event.leafIndex)}
                      aria-label={`Prove payment ${event.leafIndex}`}
                      title="Generate a per-payment proof (PDF)"
                    >
                      <FileCheck className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>

      {showSeeAll ? (
        <div className="mt-auto flex justify-end">
          <Button
            variant="glass"
            size="sm"
            className="min-h-10"
            nativeButton={false}
            render={<Link href="/dashboard/history" />}
          >
            See all
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <DiscloseDialog
        open={discloseLeaf !== null}
        onClose={() => setDiscloseLeaf(null)}
        leafIndex={discloseLeaf}
      />
    </Card>
  );
}
