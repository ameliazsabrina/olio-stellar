// @vitest-environment node
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Err, Ok } from "@stellar/stellar-sdk/contract";

const mocks = vi.hoisted(() => ({
  getPrivyUser: vi.fn(),
  getPrivyUserByWalletAddress: vi.fn(),
  getUsers: vi.fn(),
}));

vi.mock("../src/server/lib/privy", () => ({
  getPrivyUser: mocks.getPrivyUser,
  getPrivyUserByWalletAddress: mocks.getPrivyUserByWalletAddress,
}));
vi.mock("../src/server/db/mongo", () => ({ getUsers: mocks.getUsers }));
vi.mock("../src/server/modules/channels/channels.service", () => ({
  relayXdr: vi.fn(),
}));

import {
  accountSalt,
  assertPrivyWalletOwned,
  deriveAccountContractId,
  prepareSorobanTransactionForRelay,
  restoreWallet,
  unwrapContractOwner,
} from "../src/server/modules/wallets/wallets.service";

const did = "did:privy:user";
const walletId = "wallet-1";
const address = Keypair.random().publicKey();

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

describe("Olio account wallet ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts only the exact non-delegated Privy Stellar wallet", async () => {
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [linkedWallet()],
    });
    await expect(
      assertPrivyWalletOwned(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts Privy's distinct compressed public_key metadata", async () => {
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [linkedWallet({ public_key: `02${"ab".repeat(32)}` })],
    });
    await expect(
      assertPrivyWalletOwned(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).resolves.toBeUndefined();
  });

  it("re-reads Privy when the just-created wallet has not propagated", async () => {
    mocks.getPrivyUser
      .mockResolvedValueOnce({ id: did, linked_accounts: [] })
      .mockResolvedValue({ id: did, linked_accounts: [linkedWallet()] });
    await expect(
      assertPrivyWalletOwned(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.getPrivyUserByWalletAddress).not.toHaveBeenCalled();
  });

  it("falls back to the Privy address index when the user read stays stale", async () => {
    mocks.getPrivyUser.mockResolvedValue({ id: did, linked_accounts: [] });
    mocks.getPrivyUserByWalletAddress.mockResolvedValue({
      id: did,
      linked_accounts: [linkedWallet()],
    });
    await expect(
      assertPrivyWalletOwned(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.getPrivyUserByWalletAddress).toHaveBeenCalledWith(address);
  });

  it("rejects an address index hit that belongs to another identity", async () => {
    mocks.getPrivyUser.mockResolvedValue({ id: did, linked_accounts: [] });
    mocks.getPrivyUserByWalletAddress.mockResolvedValue({
      id: "did:privy:someone-else",
      linked_accounts: [linkedWallet()],
    });
    await expect(
      assertPrivyWalletOwned(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).rejects.toThrow(/not a user-owned Privy wallet/i);
  });

  it("restores an existing account when Privy changes the wallet ID", async () => {
    const existing = {
      _id: StrKey.encodeContract(Buffer.alloc(32, 8)),
      privyUserId: "did:privy:previous",
      privyWalletId: "wallet-previous",
      privyWalletAddress: address,
      encryptedMaster: { preserved: true },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const reassociated = {
      ...existing,
      privyUserId: did,
      privyWalletId: walletId,
      updatedAt: new Date(),
    };
    const users = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(() => ({
        limit: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([existing]),
        })),
      })),
      findOneAndUpdate: vi.fn().mockResolvedValue(reassociated),
    };
    mocks.getUsers.mockResolvedValue(users);
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [linkedWallet()],
    });

    await expect(restoreWallet(did)).resolves.toEqual({
      contractId: existing._id,
      privyWalletId: walletId,
      privyWalletAddress: address,
    });
    expect(users.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: existing._id,
        privyUserId: existing.privyUserId,
        privyWalletAddress: address,
      },
      {
        $set: {
          privyUserId: did,
          privyWalletId: walletId,
          updatedAt: expect.any(Date),
        },
      },
      { returnDocument: "after" },
    );
  });

  it("selects the linked wallet that controls the old account instead of the first wallet", async () => {
    const unrelatedAddress = Keypair.random().publicKey();
    const existing = {
      _id: StrKey.encodeContract(Buffer.alloc(32, 10)),
      privyUserId: "did:privy:previous",
      privyWalletId: "wallet-previous",
      privyWalletAddress: address,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const restored = { ...existing, privyUserId: did, privyWalletId: walletId };
    const toArray = vi.fn().mockResolvedValue([existing]);
    const users = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(() => ({
        limit: vi.fn(() => ({ toArray })),
      })),
      findOneAndUpdate: vi.fn().mockResolvedValue(restored),
    };
    mocks.getUsers.mockResolvedValue(users);
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [
        linkedWallet({ id: "wallet-unrelated", address: unrelatedAddress }),
        linkedWallet(),
      ],
    });

    await expect(restoreWallet(did)).resolves.toEqual({
      contractId: existing._id,
      privyWalletId: walletId,
      privyWalletAddress: address,
    });
    expect(users.find).toHaveBeenCalledWith({
      privyWalletAddress: { $in: [unrelatedAddress, address] },
    });
  });

  it("rejects ambiguous matches across multiple linked wallets", async () => {
    const otherAddress = Keypair.random().publicKey();
    const users = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(() => ({
        limit: vi.fn(() => ({
          toArray: vi
            .fn()
            .mockResolvedValue([
              { privyWalletAddress: address },
              { privyWalletAddress: otherAddress },
            ]),
        })),
      })),
    };
    mocks.getUsers.mockResolvedValue(users);
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [
        linkedWallet(),
        linkedWallet({ address: otherAddress }),
      ],
    });

    await expect(restoreWallet(did)).rejects.toThrow(/multiple Olio accounts/i);
  });

  it.each([
    { id: "attacker" },
    {
      public_key: Keypair.random().publicKey(),
      address: Keypair.random().publicKey(),
    },
    { delegated: true },
    { wallet_client_type: "external" },
    { chain_type: "ethereum" },
  ])("rejects a spoofed or ineligible wallet: %j", async (override) => {
    mocks.getPrivyUser.mockResolvedValue({
      id: did,
      linked_accounts: [linkedWallet(override)],
    });
    await expect(
      assertPrivyWalletOwned(did, {
        privyWalletId: walletId,
        privyWalletAddress: address,
      }),
    ).rejects.toThrow(/not a user-owned Privy wallet/i);
  });

  it("derives a stable network-bound v2 C-address", () => {
    const deployer = Keypair.random().publicKey();
    const salt = accountSalt(did);
    const first = deriveAccountContractId(deployer, salt, Networks.TESTNET);
    const second = deriveAccountContractId(
      deployer,
      accountSalt(did),
      Networks.TESTNET,
    );
    const otherUser = deriveAccountContractId(
      deployer,
      accountSalt("did:privy:other"),
      Networks.TESTNET,
    );
    expect(StrKey.isValidContract(first)).toBe(true);
    expect(second).toBe(first);
    expect(otherUser).not.toBe(first);
  });

  it("unwraps the Result returned by the contract owner method", () => {
    const owner = Buffer.alloc(32, 9);

    expect(unwrapContractOwner(new Ok(owner))).toEqual(owner);
    expect(() =>
      unwrapContractOwner(new Err({ message: "not initialized" })),
    ).toThrow("not initialized");
  });

  it("signs deployment XDR with the Soroban resource fee exactly once", () => {
    const signer = Keypair.random();
    const resourceFee = 25_000n;
    const sorobanData = new xdr.SorobanTransactionData({
      resources: new xdr.SorobanResources({
        footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
        instructions: 1,
        diskReadBytes: 0,
        writeBytes: 0,
      }),
      resourceFee: xdr.Int64.fromString(resourceFee.toString()),
      ext: new xdr.SorobanTransactionDataExt(0),
    });
    const operation = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: Address.contract(Buffer.alloc(32, 7)).toScAddress(),
          functionName: "deploy",
          args: [],
        }),
      ),
      auth: [],
    });
    const assembled = new TransactionBuilder(
      new Account(signer.publicKey(), "0"),
      {
        // Model the inflated fee produced by AssembledTransaction.sign().
        fee: (resourceFee + BigInt(BASE_FEE)).toString(),
        networkPassphrase: Networks.TESTNET,
        sorobanData,
      },
    )
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const prepared = prepareSorobanTransactionForRelay(
      assembled,
      sorobanData,
      signer,
    );

    expect(prepared.fee).toBe((resourceFee + BigInt(BASE_FEE)).toString());
    expect(prepared.signatures).toHaveLength(1);
  });
});
