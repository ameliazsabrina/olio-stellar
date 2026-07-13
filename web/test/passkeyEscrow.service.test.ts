// @vitest-environment node
import { Binary } from "mongodb";
import { EscrowClobberError } from "../src/server/modules/passkey/passkey.errors";

const mocks = vi.hoisted(() => ({
  updateOne: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../src/server/db/mongo", () => ({
  getUsers: async () => ({
    updateOne: mocks.updateOne,
    findOne: mocks.findOne,
  }),
}));

import {
  getEscrow,
  saveEscrow,
} from "../src/server/modules/passkey/passkey.service";

const CONTRACT = `C${"A".repeat(55)}`;
const KDF = { m: 19456, t: 2, p: 1 };
const ESCROW_IN = {
  contractId: CONTRACT,
  credentialId: "cred-1",
  encryptedMasterHex: "aa".repeat(60),
  masterSaltHex: "bb".repeat(16),
  kdfParams: KDF,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateOne.mockResolvedValue({ acknowledged: true });
});

describe("saveEscrow", () => {
  it("upserts the ciphertext + salt as Binary keyed by contractId", async () => {
    mocks.findOne.mockResolvedValue(null); // no prior escrow

    await saveEscrow(ESCROW_IN);

    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: CONTRACT });
    expect(options).toEqual({ upsert: true });

    const set = update.$set;
    expect(set.credentialId).toBe("cred-1");
    expect(set.encryptedMaster).toBeInstanceOf(Binary);
    expect(set.masterSalt).toBeInstanceOf(Binary);
    expect(Buffer.from(set.encryptedMaster.buffer).toString("hex")).toBe(
      ESCROW_IN.encryptedMasterHex,
    );
    expect(set.kdfParams).toEqual(KDF);
  });

  it("allows re-saving for the SAME credential (re-key / idempotent retry)", async () => {
    mocks.findOne.mockResolvedValue({
      credentialId: "cred-1",
      encryptedMaster: new Binary(Buffer.from("old", "utf8")),
    });

    await expect(saveEscrow(ESCROW_IN)).resolves.toBeUndefined();
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
  });

  it("refuses to clobber an escrow owned by a DIFFERENT credential", async () => {
    mocks.findOne.mockResolvedValue({
      credentialId: "cred-attacker",
      encryptedMaster: new Binary(Buffer.from("victim", "utf8")),
    });

    await expect(saveEscrow(ESCROW_IN)).rejects.toBeInstanceOf(
      EscrowClobberError,
    );
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});

describe("getEscrow", () => {
  it("returns null when no escrow blob is stored", async () => {
    mocks.findOne.mockResolvedValue({ credentialId: "cred-1" }); // wallet, no blob
    expect(await getEscrow("cred-1")).toBeNull();
  });

  it("returns the blob as hex + structured kdfParams", async () => {
    mocks.findOne.mockResolvedValue({
      credentialId: "cred-1",
      encryptedMaster: new Binary(Buffer.from("dead", "hex")),
      masterSalt: new Binary(Buffer.from("beef", "hex")),
      kdfParams: KDF,
    });

    expect(await getEscrow("cred-1")).toEqual({
      encryptedMasterHex: "dead",
      masterSaltHex: "beef",
      kdfParams: KDF,
    });
  });
});
