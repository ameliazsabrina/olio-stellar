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
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    username: "alice",
    disconnect: vi.fn(),
  }),
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
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
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

import { SettingsDashboard } from "../src/components/dashboard/SettingsDashboard";

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
    mocks.changeRecoveryPin.mockResolvedValue(undefined);
    mocks.validateCurrentPin.mockResolvedValue(true);
  });

  it("does not offer rotation when recovery is missing", () => {
    render(<SettingsDashboard />);
    expect(
      screen.queryByRole("button", { name: "Change PIN" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("shows Change PIN only for configured recovery and opens the dialog", async () => {
    mocks.escrow = configuredEscrow;
    render(<SettingsDashboard />);
    await userEvent.click(screen.getByRole("button", { name: "Change PIN" }));
    expect(
      screen.getByRole("dialog", { name: "Change recovery PIN" }),
    ).toBeInTheDocument();
  });

  it("refreshes recovery state and shows feedback after success", async () => {
    mocks.escrow = configuredEscrow;
    render(<SettingsDashboard />);
    const user = userEvent.setup();
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
