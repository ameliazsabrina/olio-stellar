// @vitest-environment node
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Ok } from "@stellar/stellar-sdk/contract";

const mocks = vi.hoisted(() => ({
  getPrivyUser: vi.fn(),
  getPrivyUserByWalletAddress: vi.fn(),
  getUsers: vi.fn(),
  clientFrom: vi.fn(),
}));

vi.mock("../src/server/lib/privy", () => ({
  getPrivyUser: mocks.getPrivyUser,
  getPrivyUserByWalletAddress: mocks.getPrivyUserByWalletAddress,
}));
vi.mock("../src/server/db/mongo", () => ({ getUsers: mocks.getUsers }));
vi.mock("../src/server/modules/channels/channels.service", () => ({
  relayXdr: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk/contract", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stellar/stellar-sdk/contract")>();
  return { ...actual, Client: { from: mocks.clientFrom, deploy: vi.fn() } };
});

import {
  accountSalt,
  bootstrapWallet,
  deriveAccountContractId,
} from "../src/server/modules/wallets/wallets.service";

const did = "did:privy:racer";
const walletId = "wallet-racer";
const address = Keypair.random().publicKey();
const deployer = Keypair.random();

function linkedWallet(overrides: Record<string, unknown> = {}) {
  return {
    type: "wallet",
    id: walletId,
    address,
    public_key: address,
    chain_type: "stellar",
    delegated: false,
    wallet_client: "privy",
    wallet_client_type: "privy",
    connector_type: "embedded",
    ...overrides,
  };
}

describe("bootstrapWallet concurrent sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // deployAccount needs these; the on-chain account is treated as already
    // deployed with the expected owner so deployAccount short-circuits.
    vi.stubEnv("OLIO_WALLET_DEPLOYER_SECRET", deployer.secret());
    vi.stubEnv("OLIO_ACCOUNT_WASM_HASH", "aa".repeat(32));
    const ownerBuf = Buffer.from(StrKey.decodeEd25519PublicKey(address));
    mocks.clientFrom.mockResolvedValue({
      owner: () => ({ result: new Ok(ownerBuf) }),
    });
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [linkedWallet()],
    });
  });

  it("reuses the row a concurrent sign-in inserted instead of 409ing", async () => {
    const contractId = deriveAccountContractId(
      deployer.publicKey(),
      accountSalt(did),
    );
    const raced = {
      _id: contractId,
      privyUserId: did,
      privyWalletId: walletId,
      privyWalletAddress: address,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    };
    const findOne = vi
      .fn()
      .mockResolvedValueOnce(null) // restoreWallet: by privyUserId
      .mockResolvedValueOnce(null) // bootstrap: existing by privyUserId
      .mockResolvedValueOnce(null) // linkExistingWallet: by $or
      .mockResolvedValueOnce(raced); // catch: re-read after 11000
    const users = {
      findOne,
      find: vi.fn(() => ({
        limit: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      })),
      updateOne: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 })),
    };
    mocks.getUsers.mockResolvedValue(users);

    await expect(
      bootstrapWallet(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).resolves.toEqual({
      contractId,
      privyWalletId: walletId,
      privyWalletAddress: address,
    });
    expect(users.updateOne).toHaveBeenCalledOnce();
  });

  it("still conflicts when the duplicate belongs to another identity", async () => {
    const findOne = vi
      .fn()
      .mockResolvedValueOnce(null) // restoreWallet
      .mockResolvedValueOnce(null) // bootstrap existing
      .mockResolvedValueOnce(null) // linkExistingWallet
      .mockResolvedValueOnce(null); // catch re-read finds nothing → genuine clash
    const users = {
      findOne,
      find: vi.fn(() => ({
        limit: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      })),
      updateOne: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 })),
    };
    mocks.getUsers.mockResolvedValue(users);

    await expect(
      bootstrapWallet(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).rejects.toThrow(/already linked to another Olio account/i);
  });
});
