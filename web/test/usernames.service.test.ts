// @vitest-environment node
import { Binary } from "mongodb";
import type { OlioAccount } from "../src/lib/stellar";
import { UsernameNotOnChainError } from "../src/server/modules/usernames/usernames.errors";

// ---- mocks -----------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  resolveUsernameOnChain: vi.fn(),
  getLatestLedger: vi.fn(),
  updateOne: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../src/lib/stellar", () => ({
  resolveUsernameOnChain: mocks.resolveUsernameOnChain,
  usernameOfOnChain: vi.fn(),
  server: { getLatestLedger: mocks.getLatestLedger },
}));

vi.mock("../src/server/db/mongo", () => ({
  getUsernames: async () => ({
    updateOne: mocks.updateOne,
    findOne: mocks.findOne,
  }),
}));

vi.mock("../src/lib/crypto", () => ({
  // Deterministic hex so we can assert the returned shape.
  bytesToHex: (b: Uint8Array) =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
}));

import { registerUsernameCache } from "../src/server/modules/usernames/usernames.service";

// ---- fixtures --------------------------------------------------------------

function fakeAccount(overrides: Partial<OlioAccount> = {}): OlioAccount {
  return {
    owner: "GCTESTOWNERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    note_pubkey: new Uint8Array(32).fill(0xab),
    view_pubkey: new Uint8Array(32).fill(0xcd),
    created: 1_700_000_000n,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLatestLedger.mockResolvedValue({ sequence: 4242 });
  mocks.updateOne.mockResolvedValue({ acknowledged: true });
});

// ---- tests -----------------------------------------------------------------

describe("registerUsernameCache", () => {
  it("throws UsernameNotOnChainError and does not write when the username is not on-chain", async () => {
    mocks.resolveUsernameOnChain.mockResolvedValue(null);

    await expect(registerUsernameCache("alice")).rejects.toBeInstanceOf(
      UsernameNotOnChainError,
    );
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("upserts the on-chain record into Mongo and returns the resolve output", async () => {
    const acct = fakeAccount();
    mocks.resolveUsernameOnChain.mockResolvedValue(acct);

    const out = await registerUsernameCache("alice");

    // Verified against the registry using the exact username we were asked about.
    expect(mocks.resolveUsernameOnChain).toHaveBeenCalledWith("alice");

    // Mirrored into Mongo as an idempotent upsert keyed by the username.
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "alice" });
    expect(options).toEqual({ upsert: true });

    const set = update.$set;
    expect(set.owner).toBe(acct.owner);
    expect(set.notePubkey).toBeInstanceOf(Binary);
    expect(set.viewPubkey).toBeInstanceOf(Binary);
    expect(new Uint8Array(set.notePubkey.buffer)).toEqual(acct.note_pubkey);
    expect(new Uint8Array(set.viewPubkey.buffer)).toEqual(acct.view_pubkey);
    expect(set.createdLedger).toBe(4242);
    expect(set.createdAt).toBeInstanceOf(Date);
    expect(set.createdAt.getTime()).toBe(Number(acct.created) * 1000);
    expect(set.updatedAt).toBeInstanceOf(Date);

    // Returned payload mirrors the on-chain keys.
    expect(out).toEqual({
      owner: acct.owner,
      notePubkeyHex: "ab".repeat(32),
      viewPubkeyHex: "cd".repeat(32),
      createdAt: new Date(Number(acct.created) * 1000).toISOString(),
    });
  });
});
