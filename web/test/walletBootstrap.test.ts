// @vitest-environment node
const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  current: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  bootstrapWallet: mocks.bootstrap,
  currentWallet: mocks.current,
  restoreWallet: mocks.restore,
  getEscrow: vi.fn(),
  saveEscrow: vi.fn(),
}));

import { walletsRouter } from "../src/server/modules/wallets/wallets.router";

const claim = {
  app_id: "app",
  issuer: "privy.io",
  issued_at: 1,
  expiration: 2,
  session_id: "session",
  user_id: "did:privy:user",
};
const caller = walletsRouter.createCaller({
  ip: null,
  authToken: "token",
  privyUserId: claim.user_id,
  privyClaim: claim,
  authError: null,
});

describe("wallet bootstrap router", () => {
  it("restores an old account from the authenticated Privy identity", async () => {
    const key = Keypair.random().publicKey();
    const contract = StrKey.encodeContract(Buffer.alloc(32, 3));
    mocks.restore.mockResolvedValue({
      contractId: contract,
      privyWalletId: "wallet-current",
      privyWalletAddress: key,
    });

    await expect(caller.restore()).resolves.toEqual({
      contractId: contract,
      privyWalletId: "wallet-current",
      privyWalletAddress: key,
    });
    expect(mocks.restore).toHaveBeenCalledWith(claim.user_id);
  });

  it("derives identity from protected context and returns the idempotent mapping", async () => {
    const key = Keypair.random().publicKey();
    const contract = StrKey.encodeContract(Buffer.alloc(32, 4));
    mocks.bootstrap.mockResolvedValue({
      contractId: contract,
      privyWalletId: "wallet-1",
      privyWalletAddress: key,
    });
    const result = await caller.bootstrap({
      privyWalletId: "wallet-1",
      privyWalletAddress: key,
    });
    expect(mocks.bootstrap).toHaveBeenCalledWith(claim.user_id, {
      privyWalletId: "wallet-1",
      privyWalletAddress: key,
    });
    expect(result.contractId).toBe(contract);
  });
});

import { Keypair, StrKey } from "@stellar/stellar-sdk";
