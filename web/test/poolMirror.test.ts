import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
}));

vi.mock("../src/trpc/client", () => ({
  api: { deposits: { snapshot: { query: mocks.snapshot } } },
}));

vi.mock("../src/lib/stellar", () => ({
  networkPassphrase: "Test SDF Network ; September 2015",
  poolId: "CPOOL",
}));

function response(
  leafIndex: number,
  publishedLedger: number,
  nullifierHex: string,
) {
  return {
    deposits: [
      {
        leafIndex,
        commitmentHex: "01".repeat(32),
        ephemeralPkHex: "02".repeat(32),
        ciphertextHex: "03".repeat(40),
        ledger: publishedLedger,
        txHash: `tx-${leafIndex}`,
        ts: new Date().toISOString(),
      },
    ],
    spentNullifiers: [{ nullifierHex, ledger: publishedLedger }],
    index: {
      poolId: "CPOOL",
      networkPassphrase: "Test SDF Network ; September 2015",
      publishedLedger,
      publishedLeafIndex: leafIndex,
      indexedAt: new Date().toISOString(),
      health: "healthy" as const,
    },
  };
}

describe("poolMirror", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.snapshot.mockReset();
  });

  it("requests and merges only changes after its local watermarks", async () => {
    const firstNullifier = "aa".repeat(32);
    const secondNullifier = "bb".repeat(32);
    mocks.snapshot
      .mockResolvedValueOnce(response(0, 10, firstNullifier))
      .mockResolvedValueOnce(response(1, 12, secondNullifier));

    const { refreshPoolMirror } = await import("../src/lib/poolMirror");
    const first = await refreshPoolMirror();
    const second = await refreshPoolMirror();

    expect(mocks.snapshot).toHaveBeenNthCalledWith(1, {
      afterLeafIndex: -1,
      spentAfterLedger: 0,
    });
    expect(mocks.snapshot).toHaveBeenNthCalledWith(2, {
      afterLeafIndex: 0,
      spentAfterLedger: 10,
    });
    expect(first.deposits).toHaveLength(1);
    expect(second.deposits.map((row) => row.leafIndex)).toEqual([0, 1]);
    expect(second.spentNullifiers).toEqual([firstNullifier, secondNullifier]);
  });

  it("deduplicates concurrent refreshes", async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    mocks.snapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { refreshPoolMirror } = await import("../src/lib/poolMirror");

    const first = refreshPoolMirror();
    const second = refreshPoolMirror();
    resolveRequest(response(0, 10, "aa".repeat(32)));

    expect(await first).toEqual(await second);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });
});
