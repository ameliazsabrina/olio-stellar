"use client";

import { ArrowDownLeft, ArrowUpRight, Download, FileCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import type { MyNote } from "../../lib/notes";
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
}: {
  notes: MyNote[];
  loading: boolean;
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

  return (
    <Card id="activity" className="gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-ink">
            Receipt ledger
          </h2>
          <p className="mt-1 text-sm text-muted-text">
            Every payment received and cashed out, discovered by your viewing
            key. Prove any single one on demand.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
        >
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Filter activity"
        className="flex w-fit items-center gap-1 rounded-lg border border-line bg-sage/40 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-panel text-olive-deep shadow-sm shadow-ink/5"
                : "text-muted-text hover:text-olive-deep"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <ul className="flex flex-col divide-y divide-line/80">
        {loading && (
          <li className="py-5 text-sm text-muted-text">Loading receipts...</li>
        )}

        {!loading && filtered.length === 0 && (
          <li className="py-5 text-sm text-muted-text">
            {tab === "Cashed out"
              ? "Nothing cashed out yet."
              : tab === "Received"
                ? "No payments received yet."
                : "No payments yet. Share your pay link to receive your first."}
          </li>
        )}

        {!loading &&
          filtered.map((event) => (
            <li key={event.id} className="flex items-center gap-3 py-3.5">
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  event.kind === "incoming"
                    ? "bg-ok/10 text-ok"
                    : "bg-gold/10 text-gold"
                }`}
              >
                {event.kind === "incoming" ? (
                  <ArrowDownLeft className="size-4" aria-hidden="true" />
                ) : (
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">
                  {event.kind === "incoming"
                    ? "Payment received"
                    : "Cashed out"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    private note
                  </Badge>
                  <span className="font-mono text-xs text-muted-text">
                    #{event.leafIndex}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div
                  className={`text-right font-mono text-sm font-semibold ${
                    event.kind === "incoming" ? "text-ok" : "text-ink"
                  }`}
                >
                  {event.kind === "incoming" ? "+" : "−"}
                  {fromBaseUnits(event.amount)} USDC
                </div>
                {event.kind === "incoming" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDiscloseLeaf(event.leafIndex)}
                    title="Generate a per-payment proof (PDF)"
                  >
                    <FileCheck className="size-3.5" aria-hidden="true" />
                    Prove
                  </Button>
                )}
              </div>
            </li>
          ))}
      </ul>

      <DiscloseDialog
        open={discloseLeaf !== null}
        onClose={() => setDiscloseLeaf(null)}
        leafIndex={discloseLeaf}
      />
    </Card>
  );
}
