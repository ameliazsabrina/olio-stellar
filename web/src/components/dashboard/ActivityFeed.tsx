"use client";

import { ArrowDownLeft, ArrowUpRight, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import type { MyNote } from "../../lib/notes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

type ActivityEvent = {
  id: string;
  kind: "incoming" | "outgoing";
  amount: bigint;
  leafIndex: number;
};

const TABS = ["All", "Incoming", "Outgoing"] as const;
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
  const header = "direction,amount_usdc,note_index\n";
  const rows = events
    .map(
      (e) =>
        `${e.kind},${fromBaseUnits(e.amount)},${e.leafIndex}`,
    )
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "olio-activity.csv";
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
  const events = useMemo(() => toEvents(notes), [notes]);
  const filtered = useMemo(() => {
    if (tab === "Incoming") return events.filter((e) => e.kind === "incoming");
    if (tab === "Outgoing") return events.filter((e) => e.kind === "outgoing");
    return events;
  }, [events, tab]);

  return (
    <Card id="activity" className="gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter activity"
          className="flex items-center gap-1 rounded-full bg-sage/60 p-1"
        >
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-olive-deep text-paper"
                  : "text-muted-text hover:text-olive-deep"
              }`}
            >
              {t}
            </button>
          ))}
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

      <ul className="flex flex-col divide-y divide-line">
        {loading && (
          <li className="py-4 text-sm text-muted-text">Loading activity…</li>
        )}

        {!loading && filtered.length === 0 && (
          <li className="py-4 text-sm text-muted-text">
            No {tab === "All" ? "" : tab.toLowerCase() + " "}activity yet.
          </li>
        )}

        {!loading &&
          filtered.map((event) => (
            <li key={event.id} className="flex items-center gap-3 py-3">
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
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
                    : "Withdrawal"}
                </div>
                <Badge variant="outline" className="mt-0.5 text-[10px]">
                  private note
                </Badge>
              </div>
              <div
                className={`shrink-0 text-sm font-semibold ${
                  event.kind === "incoming" ? "text-ok" : "text-ink"
                }`}
              >
                {event.kind === "incoming" ? "+" : "−"}
                {fromBaseUnits(event.amount)} USDC
              </div>
            </li>
          ))}
      </ul>
    </Card>
  );
}
