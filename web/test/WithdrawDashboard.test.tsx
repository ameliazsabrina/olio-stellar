// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: "C".padEnd(56, "A"),
    accountUnlocked: true,
    promptUnlock: vi.fn(),
    getSigner: vi.fn(),
  }),
}));

vi.mock("../src/components/dashboard/useMyNotes", () => ({
  useMyNotes: () => ({
    notes: [
      { leafIndex: 3, amount: 5_000_000n, salt: 1n, spent: false },
      { leafIndex: 7, amount: 8_000_000n, salt: 2n, spent: false },
    ],
    claimable: 13_000_000n,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/components/dashboard/StrandedFundsRecovery", () => ({
  StrandedFundsRecovery: () => (
    <button type="button" aria-label="Recover funds">
      Recover funds
    </button>
  ),
}));

vi.mock("../src/lib/anchor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/anchor")>();
  return { ...actual, offRampEnabled: true };
});

vi.mock("../src/lib/transak", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/transak")>();
  return { ...actual, transakEnabled: true };
});

import { WithdrawDashboard } from "../src/components/dashboard/WithdrawDashboard";

it("keeps MoneyGram disabled while whitelisting and Transak hidden", () => {
  render(<WithdrawDashboard />);

  expect(
    screen.getByRole("button", {
      name: "Withdraw all 2 payments, 1.3 USDC total",
    }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button")[0]).toHaveAccessibleName(
    "Recover funds",
  );

  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw private payment 1, 0.8 USDC",
    }),
  );

  expect(
    screen.getByRole("button", { name: /^MoneyGram cash pickup/ }),
  ).toBeDisabled();
  expect(
    screen.getByText(
      "Sandbox access pending. We’re completing MoneyGram integration and will enable cash pickup after approval.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Transak/i }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Transak bank cash-out/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^Stellar wallet/ }));
  expect(
    screen.getByRole("button", { name: "Back to withdrawal methods" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Withdrawal method")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw all 2 payments, 1.3 USDC total",
    }),
  );

  expect(
    screen.getByRole("button", { name: /^MoneyGram cash pickup/ }),
  ).toBeDisabled();
  expect(
    screen.getByText("Cash anchors process one private payment at a time."),
  ).toBeInTheDocument();
});
