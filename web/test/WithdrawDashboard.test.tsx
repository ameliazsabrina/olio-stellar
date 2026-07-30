// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
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
    notes: [],
    claimable: 0n,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/components/dashboard/StrandedFundsRecovery", () => ({
  StrandedFundsRecovery: () => null,
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

it("keeps the Transak tab hidden even when Transak is configured", () => {
  render(<WithdrawDashboard />);

  expect(
    screen.getByRole("button", { name: "Cash · Anchor" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Transak/i }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Transak bank cash-out/i)).not.toBeInTheDocument();
});
