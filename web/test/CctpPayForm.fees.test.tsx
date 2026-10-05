// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  readiness: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: vi.fn(), success: vi.fn() },
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    feeQuotes: { preview: { query: mocks.preview } },
    cctp: { readiness: { query: mocks.readiness } },
  },
}));
vi.mock("../src/features/cctpPayer/hooks/useCctpDeposit", () => ({
  useCctpDeposit: () => ({
    phase: "idle",
    status: null,
    start: vi.fn(),
    hasPendingPayment: false,
    payments: [],
    exportRecovery: vi.fn(),
    restore: vi.fn(),
  }),
}));
vi.mock("../src/features/cctpPayer/SolanaWalletProvider", () => ({
  SolanaWalletProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: null, signTransaction: undefined }),
  useConnection: () => ({ connection: {} }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  WalletMultiButton: () => <button type="button">Connect Solana</button>,
}));

import { CctpPayForm } from "../src/app/pay/[username]/CctpPayForm";

describe("CctpPayForm authoritative fee review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readiness.mockResolvedValue({
      state: "enabled",
      reason: "ready",
      checkedAt: new Date().toISOString(),
      retryAfterMs: 15_000,
      sourceDomain: 5,
    });
  });

  it("renders the server-provided fee and total", async () => {
    mocks.preview.mockResolvedValue({
      paymentAmount: "1000000000",
      feeBps: 500,
      feeAmount: "50000000",
      totalAmount: "1050000000",
      policyVersion: 2,
    });
    render(
      <CctpPayForm
        username="alice"
        notePubkey={new Uint8Array(32)}
        chain="evm"
      />,
    );
    fireEvent.change(screen.getByLabelText("USDC (from an EVM chain)"), {
      target: { value: "100" },
    });

    await waitFor(() =>
      expect(screen.getByText("Olio service fee (5%)")).toBeInTheDocument(),
    );
    expect(screen.getByText("105 USDC")).toBeInTheDocument();
    expect(screen.getByLabelText("Payment breakdown")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("keeps payment disabled while the policy is unresolved", () => {
    mocks.preview.mockReturnValue(new Promise(() => undefined));
    render(
      <CctpPayForm
        username="alice"
        notePubkey={new Uint8Array(32)}
        chain="evm"
      />,
    );
    fireEvent.change(screen.getByLabelText("USDC (from an EVM chain)"), {
      target: { value: "100" },
    });
    expect(screen.getByRole("button", { name: "Pay via CCTP" })).toBeDisabled();
    expect(screen.queryByText(/Olio service fee/)).not.toBeInTheDocument();
  });

  it("blocks payment with a mapped reason while the route gate is closed", async () => {
    mocks.readiness.mockResolvedValue({
      state: "temporarily_unavailable",
      reason: "worker_unavailable",
      checkedAt: new Date().toISOString(),
      retryAfterMs: 30_000,
      sourceDomain: 5,
    });
    mocks.preview.mockResolvedValue({
      paymentAmount: "1000000000",
      feeBps: 200,
      feeAmount: "20000000",
      totalAmount: "1020000000",
      policyVersion: 2,
    });
    render(
      <CctpPayForm
        username="alice"
        notePubkey={new Uint8Array(32)}
        chain="solana"
      />,
    );
    fireEvent.change(screen.getByLabelText("USDC (from Solana devnet)"), {
      target: { value: "100" },
    });
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringMatching(/settlement worker is offline/),
        expect.objectContaining({
          id: "cctp-route-unavailable",
          action: expect.objectContaining({ label: "Check again" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Olio service fee (2%)")).toBeInTheDocument(),
    );
    expect(mocks.readiness).toHaveBeenCalledWith({ sourceDomain: 5 });
    expect(screen.getByRole("button", { name: "Pay via CCTP" })).toBeDisabled();
    expect(
      screen.queryByText(/settlement worker is offline/),
    ).not.toBeInTheDocument();
  });

  it("re-enables payment once the route gate opens", async () => {
    mocks.preview.mockResolvedValue({
      paymentAmount: "1000000000",
      feeBps: 200,
      feeAmount: "20000000",
      totalAmount: "1020000000",
      policyVersion: 2,
    });
    render(
      <CctpPayForm
        username="alice"
        notePubkey={new Uint8Array(32)}
        chain="solana"
      />,
    );
    fireEvent.change(screen.getByLabelText("USDC (from Solana devnet)"), {
      target: { value: "100" },
    });
    await waitFor(() =>
      expect(screen.getByText("Olio service fee (2%)")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Pay via CCTP" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByText(/Checking this route/)).not.toBeInTheDocument();
  });
  it("shows Base wallet controls and checks domain 6 without a wallet", async () => {
    vi.stubGlobal("ethereum", undefined);
    render(
      <CctpPayForm
        username="alice"
        notePubkey={new Uint8Array(32)}
        chain="base"
      />,
    );
    expect(
      screen.getByLabelText("USDC (from Base Sepolia)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Burn USDC on Base Sepolia/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.readiness).toHaveBeenCalledWith({ sourceDomain: 6 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringMatching(/No EVM wallet found/),
        expect.objectContaining({ id: "cctp-evm-wallet-error" }),
      ),
    );
    vi.unstubAllGlobals();
  });
});
