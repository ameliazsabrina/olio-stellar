import { describe, expect, it } from "vitest";
import { activityCsv } from "../src/components/dashboard/ActivityFeed";

describe("activity CSV export", () => {
  it("adds settlement evidence columns to received payments only", () => {
    const csv = activityCsv(
      [
        { id: "3-out", kind: "outgoing", amount: 25_000_000n, leafIndex: 3 },
        { id: "3-in", kind: "incoming", amount: 25_000_000n, leafIndex: 3 },
        { id: "2-in", kind: "incoming", amount: 10_000_000n, leafIndex: 2 },
      ],
      new Map([
        [
          3,
          {
            settlementId: "testnet:CPOOL:3",
            txHash: "ab".repeat(32),
            ledgerClosedAt: "2026-10-01T00:00:00.000Z",
            invoiceNumber: "INV-0007",
          },
        ],
      ]),
    );
    expect(csv.split("\n")).toEqual([
      "type,amount_usdc,note_index,ledger_closed_at,tx_hash,settlement_id,invoice_number",
      "cashed_out,2.5,3,,,,",
      `received,2.5,3,2026-10-01T00:00:00.000Z,${"ab".repeat(32)},testnet:CPOOL:3,INV-0007`,
      "received,1,2,,,,",
    ]);
  });
});
