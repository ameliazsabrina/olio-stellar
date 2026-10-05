// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { encryptMaster, serializeEscrow } from "../src/lib/keys";

const mapping = {
  contractId: "CCONTRACT",
  privyWalletId: "wallet-1",
  privyWalletAddress: "GPRIVY",
};

const mocks = vi.hoisted(() => ({
  authenticated: true,
  hasLocalAccount: true,
  unstableHookValues: false,
  user: { id: "did:privy:user", linkedAccounts: [] },
  login: vi.fn(),
  logout: vi.fn(async () => {}),
  createWallet: vi.fn(),
  signRawHash: vi.fn(),
  resolveWallet: vi.fn(),
  current: vi.fn(),
  restore: vi.fn(),
  bootstrap: vi.fn(),
  getEscrow: vi.fn(),
  saveEscrow: vi.fn(),
  replace: vi.fn(),
  usernameOf: vi.fn(),
  resolveUsernameOnChain: vi.fn(),
  getAccount: vi.fn(),
  accountPubkeys: vi.fn(),
  deriveAndStoreAccount: vi.fn(),
  clearLocalAccount: vi.fn(),
  syncLocalAccountIdentity: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: mocks.authenticated,
    user: mocks.unstableHookValues
      ? { ...mocks.user, linkedAccounts: [...mocks.user.linkedAccounts] }
      : mocks.user,
    login: mocks.login,
    logout: mocks.logout,
  }),
}));

vi.mock("@privy-io/react-auth/extended-chains", () => ({
  useCreateWallet: () => ({
    createWallet: mocks.unstableHookValues
      ? (...args: Parameters<typeof mocks.createWallet>) =>
          mocks.createWallet(...args)
      : mocks.createWallet,
  }),
  useSignRawHash: () => ({ signRawHash: mocks.signRawHash }),
}));

vi.mock("next/navigation", () => {
  const router = { replace: mocks.replace };
  return { useRouter: () => router };
});

vi.mock("../src/lib/privy-wallet", () => ({
  resolvePrivyStellarWallet: mocks.resolveWallet,
  privySigner: vi.fn(() => ({ address: "CCONTRACT" })),
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    wallets: {
      current: { query: mocks.current },
      restore: { mutate: mocks.restore },
      bootstrap: { mutate: mocks.bootstrap },
      getEscrow: { query: mocks.getEscrow },
      saveEscrow: { mutate: mocks.saveEscrow },
    },
  },
}));

vi.mock("../src/lib/notes", () => ({
  hasLocalAccount: () => mocks.hasLocalAccount,
  deriveAndStoreAccount: mocks.deriveAndStoreAccount,
  getAccount: mocks.getAccount,
  accountPubkeys: mocks.accountPubkeys,
  clearLocalAccount: mocks.clearLocalAccount,
  syncLocalAccountIdentity: mocks.syncLocalAccountIdentity,
}));

vi.mock("../src/lib/stellar", () => ({
  usernameOf: mocks.usernameOf,
  resolveUsernameOnChain: mocks.resolveUsernameOnChain,
  registerUsernameCache: vi.fn(),
  setUsernamePubkeys: vi.fn(),
}));

import { useWallet, WalletProvider } from "../src/components/WalletProvider";

function Probe() {
  const {
    address,
    error,
    sessionReady,
    accountUnlocked,
    pinModalOpen,
    pinMode,
    pinError,
    submitPin,
    signIn,
    disconnect,
  } = useWallet();
  return (
    <div>
      <div data-testid="address">{address || "none"}</div>
      <div data-testid="error">{error || "none"}</div>
      <div data-testid="ready">{sessionReady ? "yes" : "no"}</div>
      <div data-testid="unlocked">{accountUnlocked ? "yes" : "no"}</div>
      <div data-testid="pin-open">{pinModalOpen ? "yes" : "no"}</div>
      <div data-testid="pin-mode">{pinMode}</div>
      <div data-testid="pin-error">{pinError || "none"}</div>
      <button type="button" onClick={signIn}>
        Retry
      </button>
      <button type="button" onClick={disconnect}>
        Disconnect
      </button>
      <button type="button" onClick={() => void submitPin("123456")}>
        Submit PIN
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = true;
  mocks.hasLocalAccount = true;
  mocks.unstableHookValues = false;
  mocks.resolveWallet.mockResolvedValue({ id: "wallet-1", address: "GPRIVY" });
  mocks.current.mockResolvedValue(mapping);
  mocks.restore.mockResolvedValue(mapping);
  mocks.bootstrap.mockResolvedValue(mapping);
  mocks.getEscrow.mockResolvedValue({
    encryptedMasterHex: "aa",
    masterSaltHex: "bb",
    kdfParams: { m: 1, t: 1, p: 1 },
  });
  mocks.saveEscrow.mockResolvedValue({ ok: true });
  mocks.usernameOf.mockResolvedValue("alice");
  mocks.getAccount.mockReturnValue({
    ownerSecret: 1n,
    viewSk: new Uint8Array(32),
  });
  mocks.accountPubkeys.mockResolvedValue({
    notePubkey: new Uint8Array(32).fill(1),
    viewPubkey: new Uint8Array(32).fill(2),
  });
  mocks.resolveUsernameOnChain.mockResolvedValue({
    owner: "CCONTRACT",
    note_pubkey: new Uint8Array(32).fill(1),
    view_pubkey: new Uint8Array(32).fill(2),
    created: 1n,
  });
});

describe("WalletProvider Privy session", () => {
  it("restores the Privy wallet mapping and Olio C-address", async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("CCONTRACT"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("yes"),
    );
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.resolveWallet).not.toHaveBeenCalled();
    expect(mocks.createWallet).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("does not restart setup when Privy returns unstable hook identities", async () => {
    mocks.unstableHookValues = true;
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("CCONTRACT"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.resolveWallet).not.toHaveBeenCalled();
    expect(mocks.createWallet).not.toHaveBeenCalled();
  });

  it("automatically bootstraps a new Privy identity", async () => {
    mocks.restore.mockResolvedValue(null);
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("CCONTRACT"),
    );
    expect(mocks.bootstrap).toHaveBeenCalledWith({
      privyWalletId: "wallet-1",
      privyWalletAddress: "GPRIVY",
    });
    expect(mocks.resolveWallet).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("retries automatic bootstrap after a recoverable failure", async () => {
    mocks.restore.mockResolvedValue(null);
    mocks.bootstrap
      .mockRejectedValueOnce(new Error("deployment unavailable"))
      .mockResolvedValueOnce(mapping);
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    expect(await screen.findByTestId("error")).toHaveTextContent(
      "deployment unavailable",
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByTestId("address")).toHaveTextContent("CCONTRACT");
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);
    expect(mocks.resolveWallet).toHaveBeenCalledTimes(1);
    expect(mocks.createWallet).not.toHaveBeenCalled();
  });

  it("logs out and clears local wallet state", async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    expect(await screen.findByTestId("address")).toHaveTextContent("CCONTRACT");
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.clearLocalAccount).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("none"),
    );
  });

  it("rejects stale cached note keys and requests escrow unlock", async () => {
    mocks.resolveUsernameOnChain.mockResolvedValue({
      owner: "CCONTRACT",
      note_pubkey: new Uint8Array(32).fill(3),
      view_pubkey: new Uint8Array(32).fill(4),
      created: 1n,
    });

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("pin-open")).toHaveTextContent("yes"),
    );
    expect(screen.getByTestId("unlocked")).toHaveTextContent("no");
    expect(screen.getByTestId("pin-error")).toHaveTextContent(
      "Your cached payment keys do not match this account",
    );
    expect(mocks.clearLocalAccount).not.toHaveBeenCalled();
  });

  it("restores the registered payment keys with the same PIN on a fresh device", async () => {
    mocks.hasLocalAccount = false;
    const master = new Uint8Array(32).fill(7);
    mocks.getEscrow.mockResolvedValue({
      ...serializeEscrow(encryptMaster(master, "123456", { m: 8, t: 1, p: 1 })),
      revision: 1,
    });

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("pin-open")).toHaveTextContent("yes"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Submit PIN" }));

    await waitFor(() =>
      expect(screen.getByTestId("unlocked")).toHaveTextContent("yes"),
    );
    expect(screen.getByTestId("pin-open")).toHaveTextContent("no");
    expect(screen.getByTestId("pin-error")).toHaveTextContent("none");
    expect(mocks.resolveUsernameOnChain).toHaveBeenCalledWith("alice");
    expect(mocks.deriveAndStoreAccount).toHaveBeenCalledTimes(1);
  });

  it("saves recovery before unlocking a genuinely new account", async () => {
    mocks.getEscrow.mockResolvedValue(null);
    mocks.usernameOf.mockResolvedValue(null);

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("pin-mode")).toHaveTextContent("set"),
    );
    expect(screen.getByTestId("unlocked")).toHaveTextContent("no");
    expect(mocks.deriveAndStoreAccount).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Submit PIN" }));
    await waitFor(() =>
      expect(mocks.deriveAndStoreAccount).toHaveBeenCalledTimes(1),
    );
    expect(mocks.saveEscrow).toHaveBeenCalledTimes(1);
    expect(mocks.saveEscrow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deriveAndStoreAccount.mock.invocationCallOrder[0],
    );
  });

  it("does not mistake an existing username without escrow for a new account", async () => {
    mocks.getEscrow.mockResolvedValue(null);

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("pin-mode")).toHaveTextContent("secure"),
    );
    expect(screen.getByTestId("unlocked")).toHaveTextContent("no");
    expect(mocks.deriveAndStoreAccount).not.toHaveBeenCalled();
  });
});
