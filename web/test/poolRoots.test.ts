import { Binary } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  deposits: [] as {
    _id: number;
    commitment: unknown;
    ledger: number;
    ts: Date;
  }[],
  roots: new Map<number, { root: string }>(),
}));

vi.mock("../src/lib/stellar", () => ({
  poolId: "CPOOL",
  simulateRead: vi.fn(),
}));
vi.mock("../src/server/db/mongo", () => ({
  getDeposits: async () => ({
    find: (filter: { _id: { $gte: number; $lt: number } }) => ({
      sort: () => ({
        toArray: async () =>
          store.deposits.filter(
            (d) => d._id >= filter._id.$gte && d._id < filter._id.$lt,
          ),
      }),
    }),
  }),
  getPoolRoots: async () => ({
    findOne: async ({ _id }: { _id: number }) => store.roots.get(_id) ?? null,
    bulkWrite: async (
      ops: {
        updateOne: {
          filter: { _id: number };
          update: { $set: { root: string } };
        };
      }[],
    ) => {
      for (const op of ops)
        store.roots.set(op.updateOne.filter._id, {
          root: op.updateOne.update.$set.root,
        });
    },
  }),
}));

import { merkleProof, toBE32, zeros } from "../src/lib/crypto";
import {
  advancePoolRoots,
  insertLeaf,
  serializeFrontier,
} from "../src/server/modules/deposits/deposits.roots";

const DEPTH = 5;
const leaves = [11n, 22n, 33n, 44n, 55n, 66n, 77n];

function deposit(index: number) {
  return {
    _id: index,
    commitment: new Binary(Buffer.from(toBE32(leaves[index]))),
    ledger: 100 + index,
    ts: new Date(index * 1000),
  };
}

beforeEach(() => {
  store.deposits = leaves.map((_, index) => deposit(index));
  store.roots = new Map();
});

describe("incremental pool roots", () => {
  it("matches the full-tree root after every insertion", async () => {
    const zeroes = await zeros(DEPTH);
    let frontier: bigint[] = [];
    for (let index = 0; index < leaves.length; index += 1) {
      const inserted = await insertLeaf(
        frontier,
        index,
        leaves[index],
        zeroes,
        DEPTH,
      );
      frontier = inserted.frontier;
      const expected = await merkleProof(leaves.slice(0, index + 1), 0, DEPTH);
      expect(inserted.root).toBe(expected.root);
    }
  }, 30_000);

  it("stores one root per leaf count and resumes from a stored frontier", async () => {
    store.deposits = store.deposits.slice(0, 4);
    const first = await advancePoolRoots(null, 4, DEPTH);
    expect(first.leafCount).toBe(4);
    expect([...store.roots.keys()]).toEqual([1, 2, 3, 4]);

    store.deposits = leaves.map((_, index) => deposit(index));
    const resumed = await advancePoolRoots(
      { rootLeafCount: 4, rootFrontier: serializeFrontier(first.frontier) },
      leaves.length,
      DEPTH,
    );
    const expected = await merkleProof(leaves, 0, DEPTH);
    expect(resumed.root).toBe(expected.root);
    expect(resumed.leafCount).toBe(leaves.length);
    expect(store.roots.get(leaves.length)?.root).toBe(
      expected.root.toString(16).padStart(64, "0"),
    );
  }, 30_000);

  it("rebuilds from scratch when the stored root for the frontier is missing", async () => {
    const rebuilt = await advancePoolRoots(
      { rootLeafCount: 3, rootFrontier: Array(DEPTH).fill("00".repeat(32)) },
      leaves.length,
      DEPTH,
    );
    expect(rebuilt.root).toBe((await merkleProof(leaves, 0, DEPTH)).root);
  }, 30_000);

  it("refuses to advance across a deposit mirror gap", async () => {
    store.deposits = store.deposits.filter((d) => d._id !== 2);
    await expect(
      advancePoolRoots(null, leaves.length, DEPTH),
    ).rejects.toThrow();
  }, 30_000);
});
