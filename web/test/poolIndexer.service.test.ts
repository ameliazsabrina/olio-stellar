import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPoolEventsSince: vi.fn(),
  fillRetentionGap: vi.fn(),
  simulateRead: vi.fn(),
  parseDepositEvent: vi.fn(),
  parseSpentEvent: vi.fn(),
  parseFeeEvent: vi.fn(),
  parseWithdrawEvent: vi.fn(),
  withdrawalBulkWrite: vi.fn(),
  rootFindOne: vi.fn(),
  rootBulkWrite: vi.fn(),
  leafCount: 0,
  currentRoot: new Uint8Array(32),
  stateFindOneAndUpdate: vi.fn(),
  stateFindOne: vi.fn(),
  stateUpdateOne: vi.fn(),
  depositBulkWrite: vi.fn(),
  depositCount: vi.fn(),
  depositDeleteMany: vi.fn(),
  nullifierBulkWrite: vi.fn(),
  nullifierDeleteMany: vi.fn(),
  feeBulkWrite: vi.fn(),
  feeDeleteMany: vi.fn(),
  relayDeleteMany: vi.fn(),
  quoteContextDeleteMany: vi.fn(),
}));

vi.mock("../src/lib/stellar", () => ({
  fetchPoolEventsSince: mocks.fetchPoolEventsSince,
  networkPassphrase: "Test SDF Network ; September 2015",
  parseDepositEvent: mocks.parseDepositEvent,
  parseSpentEvent: mocks.parseSpentEvent,
  parseFeeEvent: mocks.parseFeeEvent,
  parseWithdrawEvent: mocks.parseWithdrawEvent,
  poolId: "CPOOL",
  simulateRead: mocks.simulateRead,
}));

vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({
    findOneAndUpdate: mocks.stateFindOneAndUpdate,
    findOne: mocks.stateFindOne,
    updateOne: mocks.stateUpdateOne,
  })),
  getDeposits: vi.fn(async () => ({
    bulkWrite: mocks.depositBulkWrite,
    countDocuments: mocks.depositCount,
    deleteMany: mocks.depositDeleteMany,
  })),
  getSpentNullifiers: vi.fn(async () => ({
    bulkWrite: mocks.nullifierBulkWrite,
    deleteMany: mocks.nullifierDeleteMany,
  })),
  getFees: vi.fn(async () => ({
    bulkWrite: mocks.feeBulkWrite,
    deleteMany: mocks.feeDeleteMany,
  })),
  getCctpRelays: vi.fn(async () => ({
    deleteMany: mocks.relayDeleteMany,
  })),
  getAsyncFeeQuoteContexts: vi.fn(async () => ({
    deleteMany: mocks.quoteContextDeleteMany,
  })),
  getWithdrawals: vi.fn(async () => ({
    bulkWrite: mocks.withdrawalBulkWrite,
  })),
  getPoolRoots: vi.fn(async () => ({
    findOne: mocks.rootFindOne,
    bulkWrite: mocks.rootBulkWrite,
  })),
}));

vi.mock("../src/server/modules/datalake/datalake.events", () => ({
  fillRetentionGap: mocks.fillRetentionGap,
}));

import { toBE32, zeros } from "../src/lib/crypto";

async function emptyRoot(): Promise<Uint8Array> {
  return toBE32((await zeros(20))[20]);
}

describe("syncPoolIndex", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.fillRetentionGap.mockReset();
    mocks.fillRetentionGap.mockResolvedValue({ events: null, reason: "off" });
    mocks.parseSpentEvent.mockReset();
    mocks.stateFindOneAndUpdate.mockImplementation((_filter, update) => ({
      leaseOwner: update.$set.leaseOwner,
    }));
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
      poolId: "CPOOL",
      publishedLedger: 10,
      publishedLeafIndex: -1,
    });
    mocks.stateUpdateOne.mockResolvedValue({ acknowledged: true });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 11,
      latestLedger: 12,
    });
    mocks.leafCount = 0;
    mocks.currentRoot = await emptyRoot();
    mocks.simulateRead.mockImplementation(async (_contract, method) =>
      method === "current_root" ? mocks.currentRoot : mocks.leafCount,
    );
    mocks.parseWithdrawEvent.mockReturnValue(null);
    mocks.depositCount.mockResolvedValue(0);
  });

  it("publishes a new watermark only after completeness succeeds", async () => {
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.toLedger).toBe(12);
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          publishedLedger: 12,
          publishedLeafIndex: -1,
          health: "healthy",
        }),
      }),
    );
  });

  it("fails closed without deleting legacy state when the pool changes", async () => {
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
      poolId: "COLDPOOL",
      publishedLedger: 99,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result).toMatchObject({
      status: "degraded",
      fromLedger: 0,
      toLedger: 0,
      error: expect.stringContaining("pool configuration mismatch"),
    });
    expect(mocks.fetchPoolEventsSince).not.toHaveBeenCalled();
    expect(mocks.depositDeleteMany).not.toHaveBeenCalled();
    expect(mocks.nullifierDeleteMany).not.toHaveBeenCalled();
    expect(mocks.feeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.relayDeleteMany).not.toHaveBeenCalled();
    expect(mocks.quoteContextDeleteMany).not.toHaveBeenCalled();
  });

  it("upserts fee events idempotently by Soroban event id", async () => {
    const event = {
      id: "12-3",
      ledger: 12,
      txHash: "tx-fee",
      ledgerClosedAt: new Date(0).toISOString(),
    };
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [event],
      scannedFromLedger: 11,
      latestLedger: 12,
    });
    mocks.parseFeeEvent.mockReturnValue({
      payer: "GPAYER",
      feeRecipient: "GTREASURY",
      paymentAmount: 1_000_000_000n,
      feeAmount: 20_000_000n,
      totalAmount: 1_020_000_000n,
      policyVersion: 1,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.feesUpserted).toBe(1);
    expect(mocks.feeBulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: "12-3" },
            upsert: true,
          }),
        }),
      ],
      { ordered: false },
    );
  });

  it("keeps the published watermark unchanged on a completeness gap", async () => {
    mocks.leafCount = 1;
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("degraded");
    expect(result.toLedger).toBe(10);
    expect(mocks.stateUpdateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ publishedLedger: 12 }),
      }),
    );
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({ health: "degraded" }),
      }),
    );
  });

  it("marks nullifiers incomplete and degrades health on a retention gap", async () => {
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.gapFill).toBe("off");
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          publishedLedger: 60,
          nullifiersComplete: false,
          health: "degraded",
        }),
      }),
    );
  });

  it("tolerates a retention gap when the dev-only flag is set", async () => {
    vi.stubEnv("POOL_INDEXER_TOLERATE_RETENTION_GAP", "true");
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    try {
      const { syncPoolIndex } = await import(
        "../src/server/modules/deposits/deposits.service"
      );
      const result = await syncPoolIndex();

      expect(result.status).toBe("synced");
      expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: "pool" }),
        expect.objectContaining({
          $set: expect.objectContaining({
            publishedLedger: 60,
            nullifiersComplete: true,
            retentionGapToleratedAt: expect.any(Date),
            health: "healthy",
          }),
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not clear an already-incomplete mirror when tolerating gaps", async () => {
    vi.stubEnv("POOL_INDEXER_TOLERATE_RETENTION_GAP", "true");
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
      poolId: "CPOOL",
      publishedLedger: 10,
      publishedLeafIndex: -1,
      nullifiersComplete: false,
    });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    try {
      const { syncPoolIndex } = await import(
        "../src/server/modules/deposits/deposits.service"
      );
      await syncPoolIndex();

      expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: "pool" }),
        expect.objectContaining({
          $set: expect.objectContaining({
            nullifiersComplete: false,
            health: "degraded",
          }),
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps nullifiers incomplete sticky across a later clean sync", async () => {
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
      poolId: "CPOOL",
      publishedLedger: 10,
      publishedLeafIndex: -1,
      nullifiersComplete: false,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          nullifiersComplete: false,
          health: "degraded",
        }),
      }),
    );
  });

  it("skips work when another worker owns the lease", async () => {
    mocks.stateFindOneAndUpdate.mockResolvedValue(null);
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("skipped");
    expect(mocks.fetchPoolEventsSince).not.toHaveBeenCalled();
  });

  it("persists withdraw events with their event id for refund checks", async () => {
    const event = {
      id: "12-4",
      ledger: 12,
      txHash: "ab".repeat(32),
      ledgerClosedAt: new Date(0).toISOString(),
    };
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [event],
      scannedFromLedger: 11,
      latestLedger: 12,
    });
    mocks.parseWithdrawEvent.mockReturnValue({
      nullifierHex: "cd".repeat(32),
      dest: "GDEST",
      amount: 5_000_000n,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.withdrawalsUpserted).toBe(1);
    expect(mocks.withdrawalBulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { _id: "cd".repeat(32) },
            update: {
              $set: expect.objectContaining({
                dest: "GDEST",
                amount: 5_000_000n,
                eventId: "12-4",
                txHash: "ab".repeat(32),
              }),
            },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    );
  });

  it("records a verified root when the mirror matches current_root", async () => {
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.rootCheck).toBe("match");
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          rootLeafCount: 0,
          rootsMismatch: false,
          rootsVerifiedAt: expect.any(Date),
          health: "healthy",
        }),
      }),
    );
  });

  it("degrades health without hiding deposits when the root diverges", async () => {
    mocks.currentRoot = new Uint8Array(32).fill(9);
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.rootCheck).toBe("mismatch");
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          publishedLedger: 12,
          rootsMismatch: true,
          health: "degraded",
          lastError: expect.stringContaining("pool root"),
        }),
      }),
    );
  });

  const lastStateSet = () =>
    mocks.stateUpdateOne.mock.calls
      .map(([, u]) => u.$set)
      .filter((s) => s && "nullifiersComplete" in s)
      .at(-1);

  it("fills a retention gap from the data lake and stays complete", async () => {
    const gapEvent = {
      id: "g1",
      ledger: 50,
      ledgerClosedAt: "2026-10-01T00:00:00Z",
      txHash: "b".repeat(64),
      topic: [],
      value: {},
    };
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 200_000,
      latestLedger: 217_280,
    });
    mocks.fillRetentionGap.mockResolvedValue({
      events: [gapEvent],
      fromLedger: 11,
      toLedger: 199_999,
    });
    mocks.parseSpentEvent.mockImplementation((e) =>
      e.id === "g1" ? { nullifierHex: "ab".repeat(32) } : null,
    );
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    const result = await syncPoolIndex();

    expect(mocks.fillRetentionGap).toHaveBeenCalledWith(
      10,
      200_000,
      expect.any(Number),
    );
    expect(mocks.nullifierBulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: "ab".repeat(32) },
          }),
        }),
      ],
      { ordered: false },
    );
    expect(result.gapFill).toBe("filled");
    expect(lastStateSet()).toMatchObject({
      nullifiersComplete: true,
      retentionGapFilledAt: expect.any(Date),
    });
  });

  it("keeps the old degraded behaviour when the data lake cannot fill", async () => {
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 200_000,
      latestLedger: 217_280,
    });
    mocks.fillRetentionGap.mockResolvedValue({
      events: null,
      reason: "scanning",
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    const result = await syncPoolIndex();

    expect(result.gapFill).toBe("scanning");
    expect(lastStateSet()).toMatchObject({ nullifiersComplete: false });
  });

  it("never consults the data lake without a gap", async () => {
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    await syncPoolIndex();
    expect(mocks.fillRetentionGap).not.toHaveBeenCalled();
  });

  // A pool doc that persists the indexer's own writes across ticks.
  function statefulPool(initial: Record<string, unknown>) {
    const doc: Record<string, unknown> = {
      _id: "pool",
      poolId: "CPOOL",
      publishedLeafIndex: -1,
      ...initial,
    };
    mocks.stateFindOne.mockImplementation(async () => ({ ...doc }));
    mocks.stateUpdateOne.mockImplementation(async (filter, update) => {
      if (filter._id !== "pool") return { acknowledged: true };
      Object.assign(doc, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
      return { acknowledged: true };
    });
    return doc;
  }

  const gapEvent = {
    id: "g1",
    ledger: 50,
    ledgerClosedAt: "2026-10-01T00:00:00Z",
    txHash: "b".repeat(64),
    topic: [],
    value: {},
  };

  it("keeps an scanning gap pending and fills it on the next tick", async () => {
    const doc = statefulPool({ publishedLedger: 10 });
    mocks.fetchPoolEventsSince.mockResolvedValueOnce({
      events: [],
      scannedFromLedger: 200_000,
      latestLedger: 217_280,
    });
    mocks.fillRetentionGap.mockResolvedValueOnce({
      events: null,
      reason: "scanning",
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    const first = await syncPoolIndex();

    expect(first).toMatchObject({
      gapFill: "scanning",
      pendingGaps: 1,
      pendingGapsFilled: 0,
    });
    expect(doc).toMatchObject({
      publishedLedger: 217_280,
      nullifiersComplete: false,
      incompleteCauses: ["retention_gap"],
      pendingGaps: [
        {
          fromLedger: 11,
          toLedger: 199_999,
          firstSeenAt: expect.any(Date),
          lastReason: "scanning",
        },
      ],
      health: "degraded",
    });

    // The archive caught up; the watermark is past the gap, so only the
    // pending retry can still fill it.
    mocks.fetchPoolEventsSince.mockResolvedValueOnce({
      events: [],
      scannedFromLedger: 217_281,
      latestLedger: 217_300,
    });
    mocks.fillRetentionGap.mockResolvedValueOnce({
      events: [gapEvent],
      fromLedger: 11,
      toLedger: 199_999,
    });
    mocks.parseSpentEvent.mockImplementation((e) =>
      e.id === "g1" ? { nullifierHex: "ab".repeat(32) } : null,
    );

    const second = await syncPoolIndex();

    expect(mocks.fillRetentionGap).toHaveBeenLastCalledWith(
      10,
      200_000,
      expect.any(Number),
    );
    expect(mocks.fillRetentionGap).toHaveBeenCalledTimes(2);
    expect(mocks.nullifierBulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: "ab".repeat(32) },
            upsert: true,
          }),
        }),
      ],
      { ordered: false },
    );
    expect(second).toMatchObject({ pendingGapsFilled: 1, pendingGaps: 0 });
    expect(second).not.toHaveProperty("gapFill");
    expect(doc).toMatchObject({
      publishedLedger: 217_300,
      nullifiersComplete: true,
      retentionGapFilledAt: expect.any(Date),
      health: "healthy",
    });
    expect(doc).not.toHaveProperty("pendingGaps");
    expect(doc).not.toHaveProperty("incompleteCauses");
    expect(doc).not.toHaveProperty("lastError");
  });

  it("merges a new gap that overlaps a pending one", async () => {
    const firstSeenAt = new Date("2026-10-01T00:00:00Z");
    const doc = statefulPool({
      publishedLedger: 50,
      nullifiersComplete: false,
      incompleteCauses: ["retention_gap"],
      pendingGaps: [
        {
          fromLedger: 40,
          toLedger: 120,
          firstSeenAt,
          lastReason: "ledger_missing",
        },
      ],
    });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 200,
      latestLedger: 300,
    });
    mocks.fillRetentionGap.mockResolvedValue({
      events: null,
      reason: "scanning",
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    await syncPoolIndex();

    expect(mocks.fillRetentionGap).toHaveBeenCalledWith(
      39,
      121,
      expect.any(Number),
    );
    expect(mocks.fillRetentionGap).toHaveBeenCalledWith(
      50,
      200,
      expect.any(Number),
    );
    expect(doc.pendingGaps).toEqual([
      {
        fromLedger: 40,
        toLedger: 199,
        firstSeenAt,
        lastReason: "scanning",
      },
    ]);
    expect(doc).toMatchObject({
      nullifiersComplete: false,
      incompleteCauses: ["retention_gap"],
    });
  });

  it("merges overlapping and adjacent ranges but keeps disjoint ones apart", async () => {
    const { mergePendingGaps } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const early = new Date("2026-10-01T00:00:00Z");
    const late = new Date("2026-10-02T00:00:00Z");
    expect(
      mergePendingGaps([
        {
          fromLedger: 500,
          toLedger: 600,
          firstSeenAt: late,
          lastReason: "scanning",
        },
        {
          fromLedger: 10,
          toLedger: 20,
          firstSeenAt: late,
          lastReason: "ledger_chain_broken",
        },
        {
          fromLedger: 21,
          toLedger: 30,
          firstSeenAt: early,
          lastReason: "ledger_missing",
        },
        {
          fromLedger: 15,
          toLedger: 25,
          firstSeenAt: late,
          lastReason: "scanning",
        },
      ]),
    ).toEqual([
      {
        fromLedger: 10,
        toLedger: 30,
        firstSeenAt: early,
        lastReason: "ledger_missing",
      },
      {
        fromLedger: 500,
        toLedger: 600,
        firstSeenAt: late,
        lastReason: "scanning",
      },
    ]);
  });

  it("keeps nullifiers incomplete when a cause other than a pending gap remains", async () => {
    // Incomplete before pending-gap tracking existed, so the cause is unknown.
    const doc = statefulPool({
      publishedLedger: 10,
      nullifiersComplete: false,
      pendingGaps: [
        {
          fromLedger: 5,
          toLedger: 9,
          firstSeenAt: new Date(),
          lastReason: "scanning",
        },
      ],
    });
    mocks.fillRetentionGap.mockResolvedValue({
      events: [gapEvent],
      fromLedger: 5,
      toLedger: 9,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    const result = await syncPoolIndex();

    expect(result.pendingGapsFilled).toBe(1);
    expect(doc).not.toHaveProperty("pendingGaps");
    expect(doc).toMatchObject({
      nullifiersComplete: false,
      health: "degraded",
    });
    expect(doc).not.toHaveProperty("incompleteCauses");
  });

  it("leaves off mode exactly as before: the gap is burnt, not pended", async () => {
    statefulPool({ publishedLedger: 10 });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    const result = await syncPoolIndex();
    const write = mocks.stateUpdateOne.mock.calls.find(
      ([, u]) => u.$set && "nullifiersComplete" in u.$set,
    )?.[1];

    expect(result.gapFill).toBe("off");
    expect(result).not.toHaveProperty("pendingGaps");
    expect(write.$set).toMatchObject({ nullifiersComplete: false });
    expect(write.$set).not.toHaveProperty("pendingGaps");
    expect(write.$set).not.toHaveProperty("incompleteCauses");
    expect(write).not.toHaveProperty("$unset");

    // Stays sticky on a later clean tick.
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 61,
      latestLedger: 70,
    });
    await syncPoolIndex();
    expect(lastStateSet()).toMatchObject({ nullifiersComplete: false });
    expect(mocks.fillRetentionGap).toHaveBeenCalledTimes(1);
  });

  it("drops the gap-only cause when off mode burns a later gap", async () => {
    const doc = statefulPool({
      publishedLedger: 10,
      nullifiersComplete: false,
      incompleteCauses: ["retention_gap"],
      pendingGaps: [
        {
          fromLedger: 5,
          toLedger: 9,
          firstSeenAt: new Date(),
          lastReason: "scanning",
        },
      ],
    });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );

    await syncPoolIndex();

    expect(doc).toMatchObject({
      nullifiersComplete: false,
      pendingGaps: [
        expect.objectContaining({ fromLedger: 5, lastReason: "off" }),
      ],
    });
    expect(doc).not.toHaveProperty("incompleteCauses");
  });

  it("does not pend a tolerated gap", async () => {
    vi.stubEnv("POOL_INDEXER_TOLERATE_RETENTION_GAP", "true");
    const doc = statefulPool({ publishedLedger: 10 });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    mocks.fillRetentionGap.mockResolvedValue({
      events: null,
      reason: "ledger_missing",
    });
    try {
      const { syncPoolIndex } = await import(
        "../src/server/modules/deposits/deposits.service"
      );
      await syncPoolIndex();
      expect(doc).toMatchObject({
        nullifiersComplete: true,
        retentionGapToleratedAt: expect.any(Date),
      });
      expect(doc).not.toHaveProperty("pendingGaps");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("pends an unfinished scan even when gaps are tolerated", async () => {
    vi.stubEnv("POOL_INDEXER_TOLERATE_RETENTION_GAP", "true");
    const doc = statefulPool({ publishedLedger: 10 });
    mocks.fetchPoolEventsSince.mockResolvedValue({
      events: [],
      scannedFromLedger: 50,
      latestLedger: 60,
    });
    mocks.fillRetentionGap.mockResolvedValue({
      events: null,
      reason: "scanning",
    });
    try {
      const { syncPoolIndex } = await import(
        "../src/server/modules/deposits/deposits.service"
      );
      await syncPoolIndex();
      expect(doc).toMatchObject({
        nullifiersComplete: false,
        pendingGaps: [
          expect.objectContaining({
            fromLedger: 11,
            toLedger: 49,
            lastReason: "scanning",
          }),
        ],
      });
      expect(doc).not.toHaveProperty("retentionGapToleratedAt");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
