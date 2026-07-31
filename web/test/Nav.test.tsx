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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

    const nav = document.querySelector("[data-ed-topnav]");
    expect(nav).toHaveClass("data-[scrolled=true]:bg-none");
    expect(nav).toHaveClass("data-[scrolled=true]:bg-ed-dark-2/88");
    expect(nav?.className).not.toContain("data-[scrolled=true]:from-ed-dark-2");
  });

  it("shows the loader before the sign-in label while connecting", () => {
    mocks.useWallet.mockReturnValue(wallet({ connecting: true }));
    render(<EditionsTopNav />);

    const button = screen.getByRole("button", { name: "Signing in…" });
    expect(button.firstElementChild).toHaveClass(
      "lucide-loader",
      "motion-safe:animate-spin",
    );
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

    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByText(/GCAB|5678/)).not.toBeInTheDocument();
  });
});
