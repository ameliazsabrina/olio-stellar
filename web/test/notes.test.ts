// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanMyNotes } from "../src/lib/notes";
import { isSpent } from "../src/lib/stellar";

vi.mock("../src/lib/crypto", () => ({
  decryptNote: vi.fn(() => ({ amount: 5_000_000n, salt: 9n })),
  commitment: vi.fn(async () => 1n),
  fromBE: vi.fn(() => 1n),
  ownerPk: vi.fn(async () => 42n),
  viewPubkey: vi.fn(() => new Uint8Array([1])),
  nullifier: vi.fn(async (_secret: bigint, leafIndex: number) =>
    BigInt(leafIndex),
  ),
  toBE32: vi.fn((n: bigint) => Uint8Array.of(Number(n))),
  bytesToHex: vi.fn((b: Uint8Array) =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
  ),
  hexToBytes: vi.fn(() => new Uint8Array()),
  TREE_DEPTH: 20,
}));
vi.mock("../src/lib/keys", () => ({ deriveNoteSecrets: vi.fn() }));

const mirror = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/poolMirror", () => ({
  loadPoolMirror: vi.fn(async () => mirror.value),
  refreshPoolMirror: vi.fn(async () => mirror.value),
}));
vi.mock("../src/lib/stellar", () => ({ isSpent: vi.fn(async () => false) }));

const deposit = (leafIndex: number) => ({
  leafIndex,
  commitment: new Uint8Array(),
  ephemeralPk: new Uint8Array(),
  ciphertext: new Uint8Array(),
  receivedAt: new Date(2026, 7, leafIndex + 1).toISOString(),
});

function setMirror(
  spentNullifiers: string[],
  deposits = [deposit(0), deposit(1)],
) {
  mirror.value = {
    deposits,
    spentNullifiers,
    spentAtByNullifier: { "00": new Date(2026, 7, 3).toISOString() },
    hydrated: true,
    indexedAt: new Date().toISOString(),
    health: "healthy",
  };
}

const acct = { ownerSecret: 7n, viewSk: new Uint8Array(32) };
const mockIsSpent = vi.mocked(isSpent);

describe("scanMyNotes on-chain spent check", () => {
  beforeEach(() => {
    mockIsSpent.mockReset();
  });

  it("marks a mirror-'unspent' note spent when the contract says it's spent", async () => {
    setMirror([]);
    mockIsSpent.mockImplementation(async (bytes) => bytes[0] === 1);

    const scan = await scanMyNotes(acct);

    const byLeaf = new Map(scan.notes.map((n) => [n.leafIndex, n]));
    expect(byLeaf.get(0)?.spent).toBe(false);
    expect(byLeaf.get(1)?.spent).toBe(true);
    // Only the genuinely unspent leaf counts toward the balance.
    expect(scan.claimable).toBe(5_000_000n);
    // Both mirror-unspent notes were verified on-chain.
    expect(mockIsSpent).toHaveBeenCalledTimes(2);
  });

  it("skips the on-chain check for notes the mirror already knows are spent", async () => {
    setMirror(["00"]); // leaf 0 already spent per the mirror
    mockIsSpent.mockResolvedValue(false);

    const scan = await scanMyNotes(acct);

    expect(scan.notes.find((n) => n.leafIndex === 0)?.spent).toBe(true);
    expect(scan.notes.find((n) => n.leafIndex === 0)?.receivedAt).toBe(
      new Date(2026, 7, 1).toISOString(),
    );
    expect(scan.notes.find((n) => n.leafIndex === 0)?.spentAt).toBe(
      new Date(2026, 7, 3).toISOString(),
    );
    // Only leaf 1 (mirror-unspent) needs the on-chain round-trip.
    expect(mockIsSpent).toHaveBeenCalledTimes(1);
    expect(mockIsSpent.mock.calls[0]?.[0]?.[0]).toBe(1);
  });

  it("falls back to the mirror value when the on-chain check throws", async () => {
    setMirror([]);
    mockIsSpent.mockRejectedValue(new Error("rpc down"));

    const scan = await scanMyNotes(acct);

    expect(scan.notes.every((n) => n.spent === false)).toBe(true);
    expect(scan.claimable).toBe(10_000_000n);
  });
});
