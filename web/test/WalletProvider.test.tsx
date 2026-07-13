// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  restorePasskeyWallet: vi.fn(),
  forgetPasskeyWallet: vi.fn(),
  connectPasskeyWallet: vi.fn(),
  createPasskeyWallet: vi.fn(),
  forgetPasskeySession: vi.fn(),
  rememberPasskeySession: vi.fn(),
  passkeySigner: vi.fn(),
  replace: vi.fn(),
  usernameOf: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../src/lib/auth-session", () => ({
  forgetPasskeySession: mocks.forgetPasskeySession,
  rememberPasskeySession: mocks.rememberPasskeySession,
}));

vi.mock("../src/lib/passkey", () => ({
  connectPasskeyWallet: mocks.connectPasskeyWallet,
  createPasskeyWallet: mocks.createPasskeyWallet,
  forgetPasskeyWallet: mocks.forgetPasskeyWallet,
  passkeyConfigured: true,
  passkeySigner: mocks.passkeySigner,
  restorePasskeyWallet: mocks.restorePasskeyWallet,
}));

vi.mock("../src/lib/stellar", () => ({
  usernameOf: mocks.usernameOf,
}));

import { useWallet, WalletProvider } from "../src/components/WalletProvider";

function Probe() {
  const { address, walletType, usernameResolved, connectPasskey, disconnect } =
    useWallet();
  return (
    <div>
      <div data-testid="address">{address || "none"}</div>
      <div data-testid="wallet-type">{walletType || "none"}</div>
      <div data-testid="username-resolved">
        {usernameResolved ? "yes" : "no"}
      </div>
      <button type="button" onClick={disconnect}>
        Disconnect
      </button>
      <button type="button" onClick={connectPasskey}>
        Connect
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.restorePasskeyWallet.mockResolvedValue(null);
  mocks.usernameOf.mockResolvedValue(null);
});

describe("WalletProvider passkey session restore", () => {
  it("silently restores a stored passkey wallet on mount", async () => {
    mocks.restorePasskeyWallet.mockResolvedValue({
      contractId: "CCONTRACT",
      keyId: "credential-1",
    });
    mocks.usernameOf.mockResolvedValue("alice");

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    expect(mocks.restorePasskeyWallet).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("address")).toHaveTextContent("CCONTRACT");
    expect(screen.getByTestId("wallet-type")).toHaveTextContent("passkey");
    await waitFor(() =>
      expect(screen.getByTestId("username-resolved")).toHaveTextContent("yes"),
    );
    expect(mocks.usernameOf).toHaveBeenCalledWith("CCONTRACT");
    expect(mocks.rememberPasskeySession).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicit passkey sign-in session and routes to dashboard", async () => {
    mocks.restorePasskeyWallet.mockImplementation(() => new Promise(() => {}));
    mocks.connectPasskeyWallet.mockResolvedValue({
      contractId: "CCONTRACT",
      keyId: "credential-1",
    });
    mocks.usernameOf.mockResolvedValue("alice");

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(await screen.findByTestId("address")).toHaveTextContent("CCONTRACT");
    expect(mocks.rememberPasskeySession).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
    expect(mocks.forgetPasskeySession).not.toHaveBeenCalled();
  });

  it("forgets the stored passkey session on explicit disconnect", async () => {
    mocks.restorePasskeyWallet.mockResolvedValue({
      contractId: "CCONTRACT",
      keyId: "credential-1",
    });

    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    expect(await screen.findByTestId("address")).toHaveTextContent("CCONTRACT");
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(mocks.forgetPasskeyWallet).toHaveBeenCalledTimes(1);
    expect(mocks.forgetPasskeySession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("address")).toHaveTextContent("none");
    expect(screen.getByTestId("wallet-type")).toHaveTextContent("none");
  });
});
