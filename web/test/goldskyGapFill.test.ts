import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/goldsky-pool-events.json";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  stateFindOne: vi.fn(),
  rawToArray: vi.fn(),
  rawFind: vi.fn(),
  poolDoc: {} as Record<string, unknown>,
  fetchPoolEventsSince: vi.fn(),
  currentRoot: new Uint8Array(32),
  nullifierBulkWrite: vi.fn(),
}));
vi.mock("../src/env.server", () => ({ getServerEnv: () => mocks.env }));
// Only the RPC edges are faked; the event parsers stay real.
vi.mock("../src/lib/stellar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/stellar")>()),
  fetchPoolEventsSince: mocks.fetchPoolEventsSince,
  poolId: "CPOOL",
  simulateRead: async (_contract: string, method: string) =>
    method === "current_root" ? mocks.currentRoot : 0,
}));
vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({
    findOne: (filter: { _id: string }) =>
      filter._id === "pool" ? { ...mocks.poolDoc } : mocks.stateFindOne(filter),
    findOneAndUpdate: (
      _filter: unknown,
      update: { $set: { leaseOwner: string } },
    ) => ({
      leaseOwner: update.$set.leaseOwner,
    }),
    updateOne: async (
      filter: { _id: string },
      update: { $set?: object; $unset?: object },
    ) => {
      if (filter._id !== "pool") return;
      Object.assign(mocks.poolDoc, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {}))
        delete mocks.poolDoc[key];
    },
  })),
  getRawPoolEvents: vi.fn(async () => ({ find: mocks.rawFind })),
  getDeposits: vi.fn(async () => ({
    bulkWrite: vi.fn(),
    countDocuments: async () => 0,
  })),
  getSpentNullifiers: vi.fn(async () => ({
    bulkWrite: mocks.nullifierBulkWrite,
  })),
  getFees: vi.fn(async () => ({ bulkWrite: vi.fn() })),
  getWithdrawals: vi.fn(async () => ({ bulkWrite: vi.fn() })),
  getPoolRoots: vi.fn(async () => ({
    findOne: async () => null,
    bulkWrite: vi.fn(),
  })),
}));

import { toBE32, zeros } from "../src/lib/crypto";
import { parseSpentEvent } from "../src/lib/stellar";
import { syncPoolIndex } from "../src/server/modules/deposits/deposits.service";
import {
  fillRetentionGap,
  rawRowToEvent,
} from "../src/server/modules/goldsky/goldsky.events";

const spend = fixture.cases.find((c) => c.kind === "spend")!;
const spendDoc = {
  _id: spend.expect.rpcEventId,
  goldskyId: spend.row.id,
  ledger: spend.row.ledger_sequence,
  txHash: spend.row.transaction_hash,
  ledgerClosedAt: new Date(`${spend.row.ledger_closed_at}Z`),
  topics: spend.row.topics,
  data: spend.row.data,
  receivedAt: new Date(),
};

describe("fillRetentionGap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env = {
      POOL_GAP_FILL_SOURCE: "goldsky",
      GOLDSKY_PIPELINE_START_LEDGER: 1000,
    };
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: 300_000,
      rejectedRows: 0,
    });
    mocks.rawFind.mockReturnValue({
      sort: () => ({ toArray: mocks.rawToArray }),
    });
    mocks.rawToArray.mockResolvedValue([spendDoc]);
  });

  it("is off unless the source is goldsky", async () => {
    mocks.env = { POOL_GAP_FILL_SOURCE: "off" };
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "off",
    });
    expect(mocks.stateFindOne).not.toHaveBeenCalled();
  });

  it("refuses when the pipeline started after the watermark", async () => {
    await expect(fillRetentionGap(998, 200_000)).resolves.toEqual({
      events: null,
      reason: "archive_starts_late",
    });
    await expect(fillRetentionGap(999, 200_000)).resolves.toMatchObject({
      fromLedger: 1000,
    });
  });

  it("refuses until the heartbeat is a full margin past the gap", async () => {
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: 200_719,
      rejectedRows: 0,
    });
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "archive_behind",
    });
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: 200_720,
      rejectedRows: 0,
    });
    await expect(fillRetentionGap(5000, 200_000)).resolves.toMatchObject({
      toLedger: 199_999,
    });
  });

  it("refuses after rejected rows or a correction", async () => {
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: 300_000,
      rejectedRows: 1,
    });
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "archive_untrusted",
    });
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: 300_000,
      rejectedRows: 0,
      correctionAt: new Date(),
    });
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "archive_untrusted",
    });
  });

  it("refuses when a row in the gap was corrected", async () => {
    mocks.rawToArray.mockResolvedValue([
      { ...spendDoc, correctedAt: new Date() },
    ]);
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "corrected_rows",
    });
  });

  it("refuses instead of throwing when a row cannot be decoded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rawToArray.mockResolvedValue([
      spendDoc,
      { ...spendDoc, _id: "bad-row", data: '{"f64":1}' },
    ]);
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "archive_undecodable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("bad-row");
    warn.mockRestore();

    mocks.rawToArray.mockResolvedValue([{ ...spendDoc, topics: "not json" }]);
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fillRetentionGap(5000, 200_000)).resolves.toMatchObject({
      reason: "archive_undecodable",
    });
    quiet.mockRestore();
  });

  // A pool event the mirror parsers would drop is a hole the archive would
  // otherwise vouch for; the fill must refuse instead.
  it("refuses a spend row whose payload the spend parser rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rawToArray.mockResolvedValue([
      spendDoc,
      { ...spendDoc, _id: "short-spend", data: '{"bytes":"00"}' },
    ]);
    await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
      events: null,
      reason: "archive_undecodable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("short-spend");
    expect(warn.mock.calls[0][0]).toContain("spend");
    warn.mockRestore();
  });

  it("refuses a row whose bytes are not hex", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bytes of ["zz".repeat(32), "abc", `${"ab".repeat(32)}g`]) {
      mocks.rawToArray.mockResolvedValue([
        { ...spendDoc, _id: "bad-hex", data: `{"bytes":"${bytes}"}` },
      ]);
      await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
        events: null,
        reason: "archive_undecodable",
      });
    }
    warn.mockRestore();
  });

  it("refuses every pool event kind its parser rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const kind of ["deposit", "withdraw", "fee"]) {
      mocks.rawToArray.mockResolvedValue([
        {
          ...spendDoc,
          _id: `bad-${kind}`,
          topics: `[{"symbol":"${kind}"}]`,
          data: '{"u32":1}',
        },
      ]);
      await expect(fillRetentionGap(5000, 200_000)).resolves.toEqual({
        events: null,
        reason: "archive_undecodable",
      });
    }
    warn.mockRestore();
  });

  it("passes events the mirror does not index, such as admin events", async () => {
    mocks.rawToArray.mockResolvedValue([
      spendDoc,
      {
        ...spendDoc,
        _id: "pause",
        topics: '[{"symbol":"pause"}]',
        data: '{"u32":1}',
      },
    ]);
    const fill = await fillRetentionGap(5000, 200_000);
    expect(fill.events?.map((e) => e.id)).toEqual([
      spend.expect.rpcEventId,
      "pause",
    ]);
  });

  it("decodes every real fixture kind without refusing", async () => {
    mocks.rawToArray.mockResolvedValue(
      fixture.cases.map((c) => ({
        _id: c.expect.rpcEventId,
        goldskyId: c.row.id,
        ledger: c.row.ledger_sequence,
        txHash: c.row.transaction_hash,
        ledgerClosedAt: new Date(`${c.row.ledger_closed_at}Z`),
        topics: c.row.topics,
        data: c.row.data,
        receivedAt: new Date(),
      })),
    );
    const fill = await fillRetentionGap(5000, 200_000);
    expect(fill.events).toHaveLength(fixture.cases.length);
  });

  it("still throws on a Mongo read error so the next run retries", async () => {
    mocks.rawToArray.mockRejectedValue(new Error("mongo down"));
    await expect(fillRetentionGap(5000, 200_000)).rejects.toThrow("mongo down");
  });

  it("reads exactly the unread ledgers and decodes them", async () => {
    const fill = await fillRetentionGap(5000, 200_000);
    expect(mocks.rawFind).toHaveBeenCalledWith({
      ledger: { $gt: 5000, $lt: 200_000 },
    });
    expect(fill).toMatchObject({ fromLedger: 5001, toLedger: 199_999 });
    expect(fill.events?.[0].id).toBe(spend.expect.rpcEventId);
  });
});

// The usual outage: indexer and webhook both down past RPC retention, so the
// first tick after restart sees the gap before Goldsky has redelivered.
describe("pending gap retry through syncPoolIndex", () => {
  const nullifierHex = parseSpentEvent(rawRowToEvent(spendDoc))?.nullifierHex;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.env = {
      POOL_GAP_FILL_SOURCE: "goldsky",
      GOLDSKY_PIPELINE_START_LEDGER: 1000,
    };
    mocks.poolDoc = {
      _id: "pool",
      poolId: "CPOOL",
      publishedLedger: 5000,
      publishedLeafIndex: -1,
    };
    mocks.currentRoot = toBE32((await zeros(20))[20]);
    mocks.rawFind.mockReturnValue({
      sort: () => ({ toArray: mocks.rawToArray }),
    });
    mocks.rawToArray.mockResolvedValue([spendDoc]);
  });

  async function tick(
    goldskyLedger: number,
    scannedFrom: number,
    latest: number,
  ) {
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: goldskyLedger,
      rejectedRows: 0,
    });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: scannedFrom,
      latestLedger: latest,
    });
    return syncPoolIndex();
  }

  it("refuses while the archive is behind, then fills on a later tick", async () => {
    const first = await tick(200_000, 200_000, 217_280);
    expect(first.gapFill).toBe("archive_behind");
    expect(mocks.rawFind).not.toHaveBeenCalled();
    expect(mocks.poolDoc).toMatchObject({
      publishedLedger: 217_280,
      nullifiersComplete: false,
      pendingGaps: [
        expect.objectContaining({ fromLedger: 5001, toLedger: 199_999 }),
      ],
    });

    // One ledger short of the margin: still refused, with the same rule.
    const second = await tick(200_719, 217_281, 217_290);
    expect(second).toMatchObject({ pendingGapsFilled: 0, pendingGaps: 1 });
    expect(mocks.poolDoc.nullifiersComplete).toBe(false);

    const third = await tick(200_720, 217_291, 217_300);
    expect(third).toMatchObject({ pendingGapsFilled: 1, pendingGaps: 0 });
    expect(mocks.rawFind).toHaveBeenCalledWith({
      ledger: { $gt: 5000, $lt: 200_000 },
    });
    expect(mocks.nullifierBulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: nullifierHex },
            upsert: true,
          }),
        }),
      ],
      { ordered: false },
    );
    expect(mocks.poolDoc).toMatchObject({
      nullifiersComplete: true,
      health: "healthy",
      retentionGapFilledAt: expect.any(Date),
    });
    expect(mocks.poolDoc).not.toHaveProperty("pendingGaps");
    expect(mocks.poolDoc).not.toHaveProperty("incompleteCauses");
  });

  it("keeps retrying an untrusted archive until an operator clears it", async () => {
    mocks.stateFindOne.mockResolvedValue({
      _id: "goldsky",
      lastLedger: 300_000,
      rejectedRows: 1,
    });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 200_000,
      latestLedger: 217_280,
    });
    expect((await syncPoolIndex()).gapFill).toBe("archive_untrusted");
    expect(mocks.poolDoc.pendingGaps).toEqual([
      expect.objectContaining({ lastReason: "archive_untrusted" }),
    ]);

    const filled = await tick(300_000, 217_281, 217_300);
    expect(filled.pendingGapsFilled).toBe(1);
    expect(mocks.poolDoc.nullifiersComplete).toBe(true);
  });

  it("never pends or reads the archive with gap fill off", async () => {
    mocks.env = { POOL_GAP_FILL_SOURCE: "off" };
    await tick(300_000, 200_000, 217_280);
    await tick(300_000, 217_281, 217_300);
    expect(mocks.stateFindOne).not.toHaveBeenCalled();
    expect(mocks.rawFind).not.toHaveBeenCalled();
    expect(mocks.poolDoc.nullifiersComplete).toBe(false);
    expect(mocks.poolDoc).not.toHaveProperty("pendingGaps");
    expect(mocks.poolDoc).not.toHaveProperty("incompleteCauses");
  });
});
