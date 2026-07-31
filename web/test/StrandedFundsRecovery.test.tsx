// @vitest-environment happy-dom
import { Keypair } from "@stellar/stellar-sdk";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrandedFundsRecovery } from "../src/components/dashboard/StrandedFundsRecovery";

const bridgeMocks = vi.hoisted(() => ({
  bridgeUsdcBalance: vi.fn(),
  clearPersistedBridge: vi.fn(),
  listStrandedBridges: vi.fn(),
  reclaimBridge: vi.fn(),
}));

vi.mock("../src/lib/bridge", () => bridgeMocks);

describe("StrandedFundsRecovery", () => {
  const destination = Keypair.random().publicKey();
  const bridgeAddress = Keypair.random().publicKey();
  const strandedBridge = {
    ref: "cash-out-1",
    secret: "bridge-secret",
    publicKey: bridgeAddress,
    amount: "50000000",
    at: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.listStrandedBridges.mockReturnValue([strandedBridge]);
    bridgeMocks.bridgeUsdcBalance.mockResolvedValue(50_000_000n);
    bridgeMocks.reclaimBridge.mockResolvedValue({
      claimableBalanceId: "claimable-balance-1",
      amount: 50_000_000n,
    });
  });

  it("stays hidden while recoverable balances are being checked", () => {
    bridgeMocks.bridgeUsdcBalance.mockReturnValue(new Promise(() => {}));

    render(<StrandedFundsRecovery defaultDestination={destination} />);

    expect(
      screen.queryByRole("region", { name: "Interrupted cash-out" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Checking…")).not.toBeInTheDocument();
  });

  it("stays hidden when persisted recovery records have no funds", async () => {
    bridgeMocks.bridgeUsdcBalance.mockResolvedValue(0n);

    render(<StrandedFundsRecovery defaultDestination={destination} />);

    await waitFor(() =>
      expect(bridgeMocks.bridgeUsdcBalance).toHaveBeenCalledWith(bridgeAddress),
    );
    expect(
      screen.queryByRole("region", { name: "Interrupted cash-out" }),
    ).not.toBeInTheDocument();
  });

  it("shows a recovery card until requested, then uses the current wallet", async () => {
    const user = userEvent.setup();
    render(<StrandedFundsRecovery defaultDestination={destination} />);

    const recoveryCard = await screen.findByRole("region", {
      name: "Interrupted cash-out",
    });
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(recoveryCard.querySelector("svg")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Recover your funds" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recover funds" }));

    expect(
      screen.getByRole("dialog", { name: "Recover your funds" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current wallet")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Recover $5.00 USDC" }),
    );

    await waitFor(() =>
      expect(bridgeMocks.reclaimBridge).toHaveBeenCalledWith(
        "bridge-secret",
        destination,
      ),
    );
    expect(bridgeMocks.clearPersistedBridge).toHaveBeenCalledWith("cash-out-1");
    expect(
      await screen.findByRole("dialog", { name: "Funds recovered" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ready to claim/i)).toBeInTheDocument();
  });
});
