// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  openUsernameModal: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));
vi.mock("../src/components/landing/StellarWalletModal", () => ({
  StellarWalletModal: () => null,
}));
vi.mock("next/image", () => ({ default: () => null }));

import { EditionsTopNav } from "../src/components/landing/Nav";

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    address: "",
    connecting: false,
    username: null,
    usernameResolved: false,
    openUsernameModal: mocks.openUsernameModal,
    disconnect: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("EditionsTopNav", () => {
  it("shows a sign-in button when disconnected", () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<EditionsTopNav />);
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim username/i }),
    ).not.toBeInTheDocument();
  });

  it("shows @username when connected with a username", () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "GCABCD1234EFGH5678",
        usernameResolved: true,
        username: "alice",
      }),
    );
    render(<EditionsTopNav />);
    expect(screen.getByRole("button", { name: "@alice" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim username/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a claim-username CTA for a connected user without a username", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "GCABCD1234EFGH5678",
        usernameResolved: true,
        username: null,
      }),
    );
    render(<EditionsTopNav />);

    const cta = screen.getByRole("button", { name: /claim username/i });
    await userEvent.click(cta);
    expect(mocks.openUsernameModal).toHaveBeenCalledTimes(1);

    // The shortened-address disconnect pill is still shown.
    expect(
      screen.getByRole("button", { name: /GCAB…5678/ }),
    ).toBeInTheDocument();
  });
});
