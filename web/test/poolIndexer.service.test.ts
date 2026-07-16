import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPoolEventsSince: vi.fn(),
  simulateRead: vi.fn(),
  parseDepositEvent: vi.fn(),
  parseSpentEvent: vi.fn(),
  stateFindOneAndUpdate: vi.fn(),
  stateFindOne: vi.fn(),
  stateUpdateOne: vi.fn(),
  depositBulkWrite: vi.fn(),
  depositCount: vi.fn(),
  depositDeleteMany: vi.fn(),
  nullifierBulkWrite: vi.fn(),
  nullifierDeleteMany: vi.fn(),
}));

vi.mock("../src/lib/stellar", () => ({
  fetchPoolEventsSince: mocks.fetchPoolEventsSince,
  networkPassphrase: "Test SDF Network ; September 2015",
  parseDepositEvent: mocks.parseDepositEvent,
  parseSpentEvent: mocks.parseSpentEvent,
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
}));

describe("syncPoolIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.simulateRead.mockResolvedValue(0);
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

  it("keeps the published watermark unchanged on a completeness gap", async () => {
    mocks.simulateRead.mockResolvedValue(1);
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

  it("skips work when another worker owns the lease", async () => {
    mocks.stateFindOneAndUpdate.mockResolvedValue(null);
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("skipped");
    expect(mocks.fetchPoolEventsSince).not.toHaveBeenCalled();
  });
});
