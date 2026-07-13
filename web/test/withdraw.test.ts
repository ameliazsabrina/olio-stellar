// @vitest-environment node

import type { MyNote } from "../src/lib/notes";
import {
  claimableNotes,
  isValidDestination,
  largestNote,
} from "../src/lib/withdraw";

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
    const notes = [note(0, 5_0000000n), note(1, 9_0000000n), note(2, 20n, true)];
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
