// @vitest-environment node
import { Binary } from "mongodb";

const mocks = vi.hoisted(() => ({ getUsers: vi.fn() }));
vi.mock("../src/server/db/mongo", () => ({ getUsers: mocks.getUsers }));
vi.mock("../src/server/lib/privy", () => ({
  getPrivyUser: vi.fn(),
  getPrivyUserByWalletAddress: vi.fn(),
}));
vi.mock("../src/server/modules/channels/channels.service", () => ({
  relayXdr: vi.fn(),
}));

import {
  WalletEscrowAlreadyInitializedError,
  WalletEscrowMissingError,
  WalletEscrowRevisionConflictError,
} from "../src/server/modules/wallets/wallets.errors";
import {
  rotateEscrow,
  saveEscrow,
} from "../src/server/modules/wallets/wallets.service";

const initial = {
  encryptedMasterHex: "aa".repeat(60),
  masterSaltHex: "bb".repeat(16),
  kdfParams: { m: 19_456, t: 2, p: 1 },
};
const replacement = {
  encryptedMasterHex: "cc".repeat(60),
  masterSaltHex: "dd".repeat(16),
  kdfParams: { m: 19_456, t: 2, p: 1 },
};

describe("wallet escrow service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("initializes escrow atomically at revision 1", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn(),
    };
    mocks.getUsers.mockResolvedValue(users);

    await saveEscrow("did:privy:user", initial);

    expect(users.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        privyUserId: "did:privy:user",
        $or: expect.any(Array),
      }),
      {
        $set: expect.objectContaining({
          encryptedMaster: expect.any(Binary),
          masterSalt: expect.any(Binary),
          escrowRevision: 1,
        }),
      },
    );
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it("cannot overwrite an initialized escrow", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      findOne: vi.fn().mockResolvedValue({ encryptedMaster: new Binary() }),
    };
    mocks.getUsers.mockResolvedValue(users);
    await expect(saveEscrow("did:privy:user", initial)).rejects.toBeInstanceOf(
      WalletEscrowAlreadyInitializedError,
    );
  });

  it("rotates only the authenticated user's expected revision", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn(),
    };
    mocks.getUsers.mockResolvedValue(users);

    await expect(
      rotateEscrow("did:privy:user", {
        expectedRevision: 4,
        escrow: replacement,
      }),
    ).resolves.toEqual({ revision: 5 });
    expect(users.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        privyUserId: "did:privy:user",
        escrowRevision: 4,
        encryptedMaster: { $exists: true },
        masterSalt: { $exists: true },
        kdfParams: { $exists: true },
      }),
      {
        $set: expect.objectContaining({
          encryptedMaster: expect.any(Binary),
          masterSalt: expect.any(Binary),
          escrowRevision: 5,
        }),
      },
    );
  });

  it("rejects a stale revision without a second write", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      findOne: vi.fn().mockResolvedValue({
        encryptedMaster: new Binary(Buffer.alloc(60)),
        masterSalt: new Binary(Buffer.alloc(16)),
        kdfParams: initial.kdfParams,
        escrowRevision: 5,
      }),
    };
    mocks.getUsers.mockResolvedValue(users);
    await expect(
      rotateEscrow("did:privy:user", {
        expectedRevision: 4,
        escrow: replacement,
      }),
    ).rejects.toBeInstanceOf(WalletEscrowRevisionConflictError);
    expect(users.updateOne).toHaveBeenCalledTimes(1);
  });

  it("treats missing or partial escrow as missing and does not retry a write", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      findOne: vi.fn().mockResolvedValue({
        encryptedMaster: new Binary(Buffer.alloc(60)),
      }),
    };
    mocks.getUsers.mockResolvedValue(users);
    await expect(
      rotateEscrow("did:privy:user", {
        expectedRevision: 1,
        escrow: replacement,
      }),
    ).rejects.toBeInstanceOf(WalletEscrowMissingError);
    expect(users.updateOne).toHaveBeenCalledTimes(1);
  });
});
