// @vitest-environment node

import { beforeEach, vi } from "vitest";
import type { LocalAccount, MyNote, ScanResult } from "../src/lib/notes";
import type { Signer } from "../src/lib/stellar";
import { poolWithdraw } from "../src/lib/stellar";
import {
  claimableNotes,
  isValidDestination,
  largestNote,
  withdrawAll,
} from "../src/lib/withdraw";

// Stub every network/proving dependency so `withdrawAll` runs its real
// orchestration (classify-once, loop, aggregate) without touching Horizon, the
// prover, or the chain. `classifyDestination` sees a USDC trustline → the direct
// path; each note's `poolWithdraw` is the seam we drive for success/failure.
vi.mock("../src/lib/anchor", () => ({
  horizon: {
    loadAccount: vi.fn(async () => ({
      balances: [
        {
          asset_code: "USDC",
          asset_issuer: process.env.NEXT_PUBLIC_USDC_ISSUER || "",
        },
      ],
    })),
  },
}));
vi.mock("../src/lib/prover", () => ({
  proveWithdraw: vi.fn(async () => ({ proof: new Uint8Array(), ms: 10 })),
}));
vi.mock("../src/lib/bridge", () => ({
  createBridge: vi.fn(),
  provisionBridge: vi.fn(),
  releaseNoteToBridge: vi.fn(),
  createClaimableBalanceToDestination: vi.fn(),
}));
vi.mock("../src/lib/crypto", () => ({
  merkleProof: vi.fn(async () => ({
    root: 1n,
    pathElements: [] as bigint[],
    pathIndices: [] as number[],
  })),
  nullifier: vi.fn(async () => 2n),
  recipientField: vi.fn(() => 3n),
  toBE32: vi.fn(() => new Uint8Array(32)),
  TREE_DEPTH: 20,
}));
vi.mock("../src/lib/stellar", () => ({
  poolWithdraw: vi.fn(async () => {}),
}));

const note = (leafIndex: number, amount: bigint, spent = false): MyNote => ({
  leafIndex,
  amount,
  salt: 1n,
  spent,
});

describe("claimableNotes", () => {
  it("keeps only unspent notes, largest first", () => {
    const notes = [
      note(0, 5_0000000n),
      note(1, 10_0000000n, true), // spent — excluded
      note(2, 3_0000000n),
      note(3, 12_0000000n),
    ];
    expect(claimableNotes(notes).map((n) => n.leafIndex)).toEqual([3, 0, 2]);
  });

  it("returns an empty list when everything is spent", () => {
    expect(claimableNotes([note(0, 5n, true)])).toEqual([]);
  });
});

describe("largestNote", () => {
  it("is the biggest single unspent note (withdraw is full-note)", () => {
    const notes = [
      note(0, 5_0000000n),
      note(1, 9_0000000n),
      note(2, 20n, true),
    ];
    expect(largestNote(notes)).toBe(9_0000000n);
  });

  it("is zero with no claimable notes", () => {
    expect(largestNote([note(0, 5n, true)])).toBe(0n);
  });
});

describe("isValidDestination", () => {
  const G = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  it("accepts a Stellar public key (G…)", () => {
    expect(isValidDestination(G)).toBe(true);
    expect(isValidDestination(` ${G} `)).toBe(true);
  });

  it("rejects a username handle or empty input", () => {
    expect(isValidDestination("@alice")).toBe(false);
    expect(isValidDestination("")).toBe(false);
    expect(isValidDestination("not-an-address")).toBe(false);
  });
});

describe("withdrawAll", () => {
  // Valid G… address → classifyDestination hits the mocked trustline'd account.
  const G = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const acct = {
    ownerSecret: 7n,
    viewSk: new Uint8Array(),
  } as unknown as LocalAccount;
  const scan: ScanResult = { notes: [], leaves: [], claimable: 0n };
  const signer = {} as Signer;
  const mockPoolWithdraw = vi.mocked(poolWithdraw);

  beforeEach(() => {
    mockPoolWithdraw.mockReset();
    mockPoolWithdraw.mockResolvedValue(undefined);
  });

  it("cashes out every claimable note, largest-first, summing the total", async () => {
    const notes = [
      note(0, 5_0000000n),
      note(1, 10_0000000n),
      note(2, 3_0000000n),
    ];
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes,
      destination: G,
    });

    expect(res.mode).toBe("direct");
    expect(res.failed).toEqual([]);
    expect(res.succeeded).toHaveLength(3);
    expect(res.total).toBe(18_0000000n);
    // poolWithdraw's 3rd arg is the note amount — assert largest-first order.
    const amounts = mockPoolWithdraw.mock.calls.map((c) => c[2]);
    expect(amounts).toEqual([10_0000000n, 5_0000000n, 3_0000000n]);
  });

  it("ignores already-spent notes", async () => {
    const notes = [note(0, 5_0000000n), note(1, 9_0000000n, true)];
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes,
      destination: G,
    });

    expect(res.succeeded).toHaveLength(1);
    expect(res.total).toBe(5_0000000n);
    expect(mockPoolWithdraw).toHaveBeenCalledTimes(1);
  });

  it("continues past a failed note and reports it (no rollback)", async () => {
    mockPoolWithdraw.mockImplementation(async (_signer, _dest, amount) => {
      if (amount === 5_0000000n) throw new Error("relay rejected");
    });
    const notes = [note(0, 5_0000000n), note(1, 10_0000000n)];
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes,
      destination: G,
    });

    expect(res.succeeded).toHaveLength(1);
    expect(res.total).toBe(10_0000000n);
    expect(res.failed).toEqual([
      { leafIndex: 0, amount: 5_0000000n, error: "relay rejected" },
    ]);
  });

  it("returns a zeroed result when nothing is claimable", async () => {
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes: [note(0, 5n, true)],
      destination: G,
    });

    expect(res).toEqual({
      total: 0n,
      mode: "direct",
      succeeded: [],
      failed: [],
    });
    expect(mockPoolWithdraw).not.toHaveBeenCalled();
  });
});
