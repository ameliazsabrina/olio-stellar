// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectWallet: vi.fn(),
  walletByCredential: vi.fn(),
}));

vi.mock("passkey-kit", () => ({
  PasskeyKit: class {
    wallet = undefined;
    connectWallet = mocks.connectWallet;
  },
}));

vi.mock("@trpc/client", () => ({
  createTRPCProxyClient: () => ({
    passkey: {
      walletByCredential: { query: mocks.walletByCredential },
    },
  }),
  httpBatchLink: () => ({}),
}));

import { restorePasskeyWallet } from "../src/lib/passkey";

describe("restorePasskeyWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("initializes passkey-kit's generated wallet client on silent restore", async () => {
    window.localStorage.setItem("olio.passkey.keyId", "credential-1");
    mocks.walletByCredential.mockResolvedValue({
      contractId: "CCONTRACT",
      credentialId: "credential-1",
    });
    mocks.connectWallet.mockResolvedValue({
      contractId: "CCONTRACT",
      keyIdBase64: "credential-1",
    });

    await expect(restorePasskeyWallet()).resolves.toEqual({
      contractId: "CCONTRACT",
      keyId: "credential-1",
    });
    expect(mocks.connectWallet).toHaveBeenCalledWith({
      keyId: "credential-1",
      getContractId: expect.any(Function),
    });
  });
});
