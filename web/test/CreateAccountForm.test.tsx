// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  getAccount: vi.fn(),
  accountPubkeys: vi.fn(),
  setStoredUsername: vi.fn(),
  registerUsername: vi.fn(),
  registerUsernameCache: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: mocks.getAccount,
  accountPubkeys: mocks.accountPubkeys,
  setStoredUsername: mocks.setStoredUsername,
}));
vi.mock("../src/lib/stellar", () => ({
  registerUsername: mocks.registerUsername,
  registerUsernameCache: mocks.registerUsernameCache,
}));

import { CreateAccountForm } from "../src/components/CreateAccountForm";

const SIGNER = {
  address: "CSIGNER",
  signAuthEntries: async () => [],
  relaySoroban: async () => ({ hash: "deadbeef" }),
};
const NOTE_PK = new Uint8Array(32).fill(1);
const VIEW_PK = new Uint8Array(32).fill(2);

function setup() {
  const onClaimed = vi.fn();
  render(<CreateAccountForm onClaimed={onClaimed} />);
  return { onClaimed };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useWallet.mockReturnValue({ getSigner: () => SIGNER });
  mocks.getAccount.mockReturnValue({
    ownerSecret: 1n,
    viewSk: new Uint8Array(32),
  });
  mocks.accountPubkeys.mockResolvedValue({
    notePubkey: NOTE_PK,
    viewPubkey: VIEW_PK,
  });
  mocks.registerUsername.mockResolvedValue(undefined);
  mocks.registerUsernameCache.mockResolvedValue(undefined);
});

describe("CreateAccountForm", () => {
  it("registers on-chain, mirrors to the DB, then claims the username", async () => {
    const { onClaimed } = setup();

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));

    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith("alice"));

    expect(mocks.registerUsername).toHaveBeenCalledWith(
      SIGNER,
      "alice",
      NOTE_PK,
      VIEW_PK,
    );
    expect(mocks.registerUsernameCache).toHaveBeenCalledWith("alice");
    expect(mocks.setStoredUsername).toHaveBeenCalledWith("alice");

    // On-chain register must happen before the DB mirror.
    expect(mocks.registerUsername.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerUsernameCache.mock.invocationCallOrder[0],
    );
  });

  it("still claims the username when the DB mirror fails (soft-fail)", async () => {
    mocks.registerUsernameCache.mockRejectedValue(new Error("mongo down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onClaimed } = setup();

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));

    // The on-chain register succeeded, so the claim proceeds regardless.
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith("alice"));
    expect(mocks.setStoredUsername).toHaveBeenCalledWith("alice");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("surfaces an error and does not claim when the on-chain register fails", async () => {
    mocks.registerUsername.mockRejectedValue(new Error("user rejected"));
    const { onClaimed } = setup();

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));

    expect(await screen.findByText(/user rejected/i)).toBeInTheDocument();
    expect(mocks.registerUsernameCache).not.toHaveBeenCalled();
    expect(mocks.setStoredUsername).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("refuses to register when the account is locked (no master)", async () => {
    mocks.getAccount.mockReturnValue(null);
    const { onClaimed } = setup();

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));

    expect(await screen.findByText(/locked/i)).toBeInTheDocument();
    // Registering random/absent pubkeys is exactly the desync we prevent.
    expect(mocks.registerUsername).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });
});
