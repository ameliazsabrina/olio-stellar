import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPoolEventsSince: vi.fn(),
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

import { toBE32, zeros } from "../src/lib/crypto";

async function emptyRoot(): Promise<Uint8Array> {
  return toBE32((await zeros(20))[20]);
}

describe("syncPoolIndex", () => {
  beforeEach(async () => {
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
});
