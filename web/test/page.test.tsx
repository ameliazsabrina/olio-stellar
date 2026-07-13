// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  getAccount: vi.fn(),
  scanMyNotes: vi.fn(),
  usdcBalanceLabel: vi.fn(),
  addUsdcTrustline: vi.fn(),
  openUsernameModal: vi.fn(),
}));

// Passthrough stubs for the GSAP-driven landing shell (not under test here).
vi.mock("../src/components/landing/Chrome", () => ({
  Chrome: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../src/components/landing/Hero", () => ({
  Hero: () => {
    const wallet = mocks.useWallet();
    if (!wallet.address) return <div>Connect your wallet</div>;
    if (wallet.usernameResolved && !wallet.username) {
      return (
        <button type="button" onClick={wallet.openUsernameModal}>
          Claim your username
        </button>
      );
    }
    return null;
  },
}));
vi.mock("../src/components/landing/ProblemStatement", () => ({
  ProblemStatement: () => null,
}));
vi.mock("../src/components/landing/Solution", () => ({ Solution: () => null }));
vi.mock("../src/components/landing/Steps", () => ({ Steps: () => null }));
vi.mock("../src/components/landing/Users", () => ({ Users: () => null }));
vi.mock("../src/components/landing/StellarAcknowledgement", () => ({
  StellarAcknowledgement: () => null,
}));
vi.mock("../src/components/landing/Faq", () => ({ Faq: () => null }));
vi.mock("../src/components/landing/Footer", () => ({ Footer: () => null }));
vi.mock("../src/components/WalletStatus", () => ({ WalletStatus: () => null }));
vi.mock("../src/components/DepositForm", () => ({
  DepositForm: () => <div>DEPOSIT_FORM</div>,
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: mocks.getAccount,
  scanMyNotes: mocks.scanMyNotes,
}));
vi.mock("../src/lib/stellar", () => ({
  registryId: "REGISTRY",
  poolId: "POOL",
  usdcBalanceLabel: mocks.usdcBalanceLabel,
  addUsdcTrustline: mocks.addUsdcTrustline,
}));

import DashboardPage from "../src/app/dashboard/page";
import Home from "../src/app/page";

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    address: "",
    getSigner: vi.fn(),
    username: null,
    usernameResolved: false,
    sessionReady: true,
    openUsernameModal: mocks.openUsernameModal,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usdcBalanceLabel.mockResolvedValue("0");
  mocks.getAccount.mockReturnValue(null);
  mocks.scanMyNotes.mockResolvedValue({ notes: [], leaves: [], claimable: 0n });
});

describe("Home get-started gating", () => {
  it("shows the connect prompt when no wallet is connected", async () => {
    mocks.useWallet.mockReturnValue(wallet({ address: "" }));
    render(<Home />);

    expect(await screen.findByText(/connect your wallet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim your username/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
  });

  it("shows a claim-username CTA that opens the modal when connected without a username", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({ address: "GCSIGNER", usernameResolved: true, username: null }),
    );
    render(<Home />);

    const cta = await screen.findByRole("button", {
      name: /claim your username/i,
    });
    await userEvent.click(cta);
    expect(mocks.openUsernameModal).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
    expect(screen.queryByText(/connect your wallet/i)).not.toBeInTheDocument();
  });

  it("keeps the dashboard off the public landing page once connected", () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "GCSIGNER",
        usernameResolved: true,
        username: "alice",
      }),
    );
    render(<Home />);

    expect(
      screen.queryByRole("heading", { name: /dashboard/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/private balance/i)).not.toBeInTheDocument();
  });
});

describe("Dashboard route", () => {
  it("renders the dashboard while username lookup is pending", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "GCSIGNER",
        sessionReady: true,
        usernameResolved: false,
        username: null,
      }),
    );
    mocks.getAccount.mockReturnValue({
      ownerSecret: 1n,
      viewSk: new Uint8Array(32),
    });

    render(<DashboardPage />);

    expect(
      await screen.findByRole("heading", { name: /dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/username pending/i).length).toBeGreaterThan(0);
  });

  it("shows the private dashboard once connected with a claimed username", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "GCSIGNER",
        sessionReady: true,
        usernameResolved: true,
        username: "alice",
      }),
    );
    mocks.getAccount.mockReturnValue({
      ownerSecret: 1n,
      viewSk: new Uint8Array(32),
    });
    render(<DashboardPage />);

    expect(
      await screen.findByRole("heading", { name: /dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/private balance/i)).toBeInTheDocument();
    expect(screen.getByText(/personal pay link/i)).toBeInTheDocument();
    expect(screen.getAllByText("@alice").length).toBeGreaterThan(0);
    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim your username/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/connect your wallet/i)).not.toBeInTheDocument();
  });
});
