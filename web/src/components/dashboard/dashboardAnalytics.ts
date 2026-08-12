import type { MyNote } from "../../lib/notes";

export type WeeklyActivity = {
  buckets: number[];
  received: number;
  cashedOut: number;
};

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function weeklyActivity(
  notes: MyNote[],
  now = new Date(),
): WeeklyActivity {
  const firstDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  );
  const buckets = Array.from({ length: 7 }, () => 0);
  let received = 0;
  let cashedOut = 0;

  function add(value: string | undefined, kind: "received" | "cashedOut") {
    const date = validDate(value);
    if (!date || date < firstDay || date > now) return;
    const localDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const index = Math.round(
      (localDay.getTime() - firstDay.getTime()) / 86_400_000,
    );
    if (index < 0 || index > 6) return;
    buckets[index] += 1;
    if (kind === "received") received += 1;
    else cashedOut += 1;
  }

  for (const note of notes) {
    add(note.receivedAt, "received");
    add(note.spentAt, "cashedOut");
  }

  return { buckets, received, cashedOut };
}
