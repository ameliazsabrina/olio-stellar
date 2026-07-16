import { Binary } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPoolEventsSince: vi.fn(),
  simulateRead: vi.fn(),
  stateFindOne: vi.fn(),
  depositFind: vi.fn(),
  nullifierFind: vi.fn(),
}));

function cursor<T>(rows: T[]) {
  return {
    sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
  };
}

vi.mock("../src/lib/stellar", () => ({
  fetchPoolEventsSince: mocks.fetchPoolEventsSince,
  networkPassphrase: "Test SDF Network ; September 2015",
  parseDepositEvent: vi.fn(),
  parseSpentEvent: vi.fn(),
  poolId: "CPOOL",
  simulateRead: mocks.simulateRead,
}));

vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({ findOne: mocks.stateFindOne })),
  getDeposits: vi.fn(async () => ({ find: mocks.depositFind })),
  getSpentNullifiers: vi.fn(async () => ({ find: mocks.nullifierFind })),
}));

describe("getPoolSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves incremental rows below the published watermark without RPC", async () => {
    const indexedAt = new Date();
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
      poolId: "CPOOL",
      publishedLedger: 25,
      publishedLeafIndex: 4,
      indexedAt,
      health: "healthy",
    });
    mocks.depositFind.mockReturnValue(
      cursor([
        {
          _id: 4,
          commitment: new Binary(Buffer.alloc(32, 1)),
          ephemeralPk: new Binary(Buffer.alloc(32, 2)),
          ciphertext: new Binary(Buffer.alloc(40, 3)),
          ledger: 24,
          txHash: "tx-deposit",
          ts: indexedAt,
        },
      ]),
    );
    mocks.nullifierFind.mockReturnValue(
      cursor([
        {
          _id: "aa".repeat(32),
          ledger: 25,
          eventId: "25-1",
          txHash: "tx-spend",
          ts: indexedAt,
        },
      ]),
    );

    const { getPoolSnapshot } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const snapshot = await getPoolSnapshot(3, 20);

    expect(mocks.depositFind).toHaveBeenCalledWith({
      _id: { $gt: 3, $lte: 4 },
    });
    expect(mocks.nullifierFind).toHaveBeenCalledWith({
      ledger: { $gt: 20, $lte: 25 },
    });
    expect(snapshot.deposits).toHaveLength(1);
    expect(snapshot.spentNullifiers).toEqual([
      { nullifierHex: "aa".repeat(32), ledger: 25 },
    ]);
    expect(snapshot.index.health).toBe("healthy");
    expect(mocks.fetchPoolEventsSince).not.toHaveBeenCalled();
    expect(mocks.simulateRead).not.toHaveBeenCalled();
  });
});
