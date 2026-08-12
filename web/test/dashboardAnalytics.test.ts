import { describe, expect, it } from "vitest";
import { weeklyActivity } from "../src/components/dashboard/dashboardAnalytics";
import type { MyNote } from "../src/lib/notes";

function note(overrides: Partial<MyNote>): MyNote {
  return {
    leafIndex: 0,
    amount: 1n,
    salt: 1n,
    spent: false,
    ...overrides,
  };
}

describe("weeklyActivity", () => {
  it("groups timestamps into seven local calendar-day buckets", () => {
    const now = new Date(2026, 7, 11, 15, 30);
    const result = weeklyActivity(
      [
        note({ receivedAt: new Date(2026, 7, 5, 0, 0).toISOString() }),
        note({ receivedAt: new Date(2026, 7, 11, 15, 30).toISOString() }),
        note({
          receivedAt: new Date(2026, 7, 9, 12).toISOString(),
          spentAt: new Date(2026, 7, 10, 8).toISOString(),
        }),
      ],
      now,
    );

    expect(result).toEqual({
      buckets: [1, 0, 0, 0, 1, 1, 1],
      received: 3,
      cashedOut: 1,
    });
  });

  it("excludes future, expired, invalid, and legacy timestamp-free records", () => {
    const now = new Date(2026, 7, 11, 15, 30);
    const result = weeklyActivity(
      [
        note({ receivedAt: new Date(2026, 7, 4, 23, 59).toISOString() }),
        note({ receivedAt: new Date(2026, 7, 11, 15, 31).toISOString() }),
        note({ receivedAt: "not-a-date", spent: true }),
        note({ spent: true }),
      ],
      now,
    );

    expect(result).toEqual({
      buckets: [0, 0, 0, 0, 0, 0, 0],
      received: 0,
      cashedOut: 0,
    });
  });
});
