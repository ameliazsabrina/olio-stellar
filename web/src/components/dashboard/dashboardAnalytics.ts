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

type LinkLike = {
  id: string;
  slug: string;
  label: string | null;
  description: string | null;
  amount: string | null;
  status: "pending" | "paid";
  state: "active" | "archived";
};

export type LinkStatusSummary = {
  key: "paid" | "pending" | "archived";
  label: string;
  count: number;
  amount: bigint;
};

function linkUnits(amount: string | null): bigint {
  if (!amount || !/^\d+$/.test(amount)) return 0n;
  return BigInt(amount);
}

/// Groups links into paid, waiting and archived; archived wins over status.
export function linkStatusSummary(links: LinkLike[]): LinkStatusSummary[] {
  const rows: LinkStatusSummary[] = [
    { key: "paid", label: "Paid", count: 0, amount: 0n },
    { key: "pending", label: "Waiting for payment", count: 0, amount: 0n },
    { key: "archived", label: "Archived", count: 0, amount: 0n },
  ];
  for (const link of links) {
    const row =
      link.state === "archived"
        ? rows[2]
        : link.status === "paid"
          ? rows[0]
          : rows[1];
    row.count += 1;
    row.amount += linkUnits(link.amount);
  }
  return rows;
}

/// Paid links with a fixed amount, largest first.
export function topPaidLinks(
  links: LinkLike[],
  limit = 4,
): { id: string; label: string; amount: bigint }[] {
  return links
    .filter((link) => link.status === "paid" && linkUnits(link.amount) > 0n)
    .map((link) => ({
      id: link.id,
      label: link.label || link.description || link.slug,
      amount: linkUnits(link.amount),
    }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .slice(0, limit);
}
