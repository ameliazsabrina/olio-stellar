// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  escrow: null as null | {
    encryptedMasterHex: string;
    masterSaltHex: string;
    kdfParams: { m: number; t: number; p: number };
    revision: number;
  },
  changeRecoveryPin: vi.fn(),
  validateCurrentPin: vi.fn(),
  refetch: vi.fn(),
  toastSuccess: vi.fn(),
  business: null as null | {
    businessId: string;
    type: "individual" | "company";
  },
  verificationStatus: null as null | {
    eligibility: string;
    credential: null | { status: string; published: boolean };
  },
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    username: "alice",
    disconnect: vi.fn(),
  }),
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ passport: { identity: { setData: vi.fn() } } }),
    passport: {
      identity: { useQuery: () => ({ data: null, isLoading: false }) },
      setVisibility: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    wallets: {
      getEscrow: {
        useQuery: () => ({
          data: mocks.escrow,
          isLoading: false,
          refetch: mocks.refetch,
        }),
      },
    },
  },
}));
vi.mock("../src/features/verification/useVerification", () => ({
  useVerification: () => ({
    business: mocks.business,
    status: mocks.verificationStatus,
    businessesLoading: false,
    statusLoading: false,
  }),
}));
vi.mock("../src/features/recovery/hooks/useChangeRecoveryPin", () => ({
  useChangeRecoveryPin: () => ({
    changeRecoveryPin: mocks.changeRecoveryPin,
    validateCurrentPin: mocks.validateCurrentPin,
    isChanging: false,
  }),
  RecoveryNotConfiguredError: class extends Error {},
  RecoveryRevisionConflictError: class extends Error {},
  RecoveryPinChangeError: class extends Error {},
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

import { SettingsDashboard } from "../src/components/dashboard/SettingsDashboard";

// Selecting a tab writes its hash, which would leak into the next test.
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

async function openSection(name: string) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

const configuredEscrow = {
  encryptedMasterHex: "aa".repeat(60),
  masterSaltHex: "bb".repeat(16),
  kdfParams: { m: 19_456, t: 2, p: 1 },
  revision: 1,
};

describe("SettingsDashboard recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.escrow = null;
    mocks.business = null;
    mocks.verificationStatus = null;
    mocks.changeRecoveryPin.mockResolvedValue(undefined);
    mocks.validateCurrentPin.mockResolvedValue(true);
  });

  it("does not offer rotation when recovery is missing", async () => {
    render(<SettingsDashboard />);
    await openSection("Security");
    expect(
      screen.queryByRole("button", { name: "Change PIN" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("shows Change PIN only for configured recovery and opens the dialog", async () => {
    mocks.escrow = configuredEscrow;
    render(<SettingsDashboard />);
    await openSection("Security");
    await userEvent.click(screen.getByRole("button", { name: "Change PIN" }));
    expect(
      screen.getByRole("dialog", { name: "Change recovery PIN" }),
    ).toBeInTheDocument();
  });

  it("refreshes recovery state and shows feedback after success", async () => {
    mocks.escrow = configuredEscrow;
    render(<SettingsDashboard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Change PIN" }));
    await user.type(screen.getByLabelText("Current PIN"), "123456");
    await user.type(screen.getByLabelText("New PIN"), "654321");
    await user.type(screen.getByLabelText("Confirm new PIN"), "654321");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Change PIN",
      }),
    );

    await waitFor(() =>
      expect(mocks.changeRecoveryPin).toHaveBeenCalledWith("123456", "654321"),
    );
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Recovery PIN changed");
  });
});

describe("SettingsDashboard identity verification", () => {
  it("offers to start verification from Account when no business profile exists", () => {
    render(<SettingsDashboard />);
    expect(
      screen.getByRole("link", { name: "Start verification" }),
    ).toHaveAttribute("href", "/verification");
    expect(
      screen.queryByRole("tab", { name: "Verification" }),
    ).not.toBeInTheDocument();
  });

  it("shows the verified status in Account once verified", () => {
    mocks.business = { businessId: "biz_1", type: "individual" };
    mocks.verificationStatus = {
      eligibility: "approved",
      credential: { status: "active", published: false },
    };
    render(<SettingsDashboard />);
    const verified = screen.getByRole("region", {
      name: "Your identity is verified",
    });
    expect(verified).toBeVisible();
    expect(verified).toHaveTextContent(
      "Your identity is verified. You can download a payment statement of your track record.",
    );
  });
});

describe("SettingsDashboard passport", () => {
  it("hosts the passport PDF without publishing controls", async () => {
    render(<SettingsDashboard />);
    await openSection("Track Record");
    expect(
      screen.getByText(/available once identity verification is approved/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Publish badge/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    "/settings#track-record",
    "/settings#passport",
  ])("opens the Track Record section from a %s deep link", (url) => {
    window.history.replaceState(null, "", url);
    render(<SettingsDashboard />);
    expect(screen.getByRole("tab", { name: "Track Record" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tabpanel", { name: "Track Record" }),
    ).toBeVisible();
  });
});

describe("SettingsDashboard section tabs", () => {
  it("shows one section at a time and moves with the arrow keys", async () => {
    render(<SettingsDashboard />);
    const account = screen.getByRole("tab", { name: "Account" });
    expect(account).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("@alice")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Change PIN" }),
    ).not.toBeInTheDocument();

    account.focus();
    await userEvent.keyboard("{ArrowDown}");
    const security = screen.getByRole("tab", { name: "Security" });
    expect(security).toHaveAttribute("aria-selected", "true");
    expect(security).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Security" })).toBeVisible();
  });
});
