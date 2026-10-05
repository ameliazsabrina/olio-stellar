// @vitest-environment happy-dom

import { StrKey } from "@stellar/stellar-sdk";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanMyNotes: vi.fn(),
  withdrawNote: vi.fn(),
}));

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

vi.mock("../src/lib/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/notes")>();
  return {
    ...actual,
    getAccount: () => ({}),
    scanMyNotes: mocks.scanMyNotes,
  };
});

vi.mock("../src/lib/withdraw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/withdraw")>();
  return {
    ...actual,
    withdrawNote: mocks.withdrawNote,
  };
});

import { WithdrawDashboard } from "../src/components/dashboard/WithdrawDashboard";

it("offers wallet withdrawals for single and bulk payments", () => {
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

  const singleDialog = screen.getByRole("dialog");
  expect(within(singleDialog).getByText("$0.8")).toBeInTheDocument();
  expect(
    within(singleDialog).getByText("from one private payment"),
  ).toBeInTheDocument();

  expect(screen.queryByRole("button", { name: /cash pickup/i })).toBeNull();

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

  expect(screen.queryByRole("button", { name: /cash pickup/i })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /^Stellar wallet/ }));
  const bulkDialog = screen.getByRole("dialog");
  expect(within(bulkDialog).queryByText("Sending")).not.toBeInTheDocument();
  expect(within(bulkDialog).getByText("$1.3")).toBeInTheDocument();
  expect(
    within(bulkDialog).getByText("across 2 private payments"),
  ).toBeInTheDocument();
});

it("allows the proof-generation dialog to be closed", async () => {
  mocks.scanMyNotes.mockResolvedValue({
    notes: [{ leafIndex: 7, amount: 8_000_000n, salt: 2n, spent: false }],
  });
  mocks.withdrawNote.mockReturnValue(new Promise(() => {}));

  render(<WithdrawDashboard />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw private payment 1, 0.8 USDC",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Stellar wallet/ }));
  fireEvent.change(screen.getByLabelText("Destination wallet"), {
    target: {
      value: StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(7)),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm & cash out" }),
  );

  expect(
    await screen.findByText(
      "The zero-knowledge proof is built in your browser. This can take a few seconds.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    screen.queryByText(
      "The zero-knowledge proof is built in your browser. This can take a few seconds.",
    ),
  ).not.toBeInTheDocument();
});
