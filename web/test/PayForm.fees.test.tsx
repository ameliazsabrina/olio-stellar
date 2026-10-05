// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));

vi.mock("../src/trpc/client", () => ({
  api: {
    feeQuotes: {
      preview: { query: mocks.preview },
      issue: { mutate: vi.fn() },
    },
  },
}));
vi.mock("../src/features/payerWallet/hooks/usePayerWallet", () => ({
  usePayerWallet: () => ({
    address: null,
    connecting: false,
    error: null,
    connect: vi.fn(),
  }),
}));
vi.mock("../src/lib/cctp", () => ({ cctpIntakeContract: "" }));
vi.mock("../src/app/pay/[username]/CctpPayForm", () => ({
  CctpPayForm: () => null,
}));

import { PayForm } from "../src/app/pay/[username]/PayForm";

const account = {
  note_pubkey: new Uint8Array(32),
  view_pubkey: new Uint8Array(32),
} as never;

describe("PayForm authoritative fee review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the server-provided special tier and gross total", async () => {
    mocks.preview.mockResolvedValue({
      paymentAmount: "1000000000",
      feeBps: 500,
      feeAmount: "50000000",
      totalAmount: "1050000000",
      policyVersion: 2,
    });
    render(
      <PayForm
        account={
          {
            note_pubkey: new Uint8Array(32),
            view_pubkey: new Uint8Array(32),
          } as never
        }
        username="alice"
      />,
    );
    fireEvent.change(screen.getByLabelText("USDC"), {
      target: { value: "100" },
    });

    await waitFor(() =>
      expect(screen.getByText("Olio service fee (5%)")).toBeInTheDocument(),
    );
    expect(screen.getByText("105 USDC")).toBeInTheDocument();
    expect(screen.getAllByText("100 USDC", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByLabelText("Payment breakdown")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("does not display a default fee while policy resolution is pending", () => {
    mocks.preview.mockReturnValue(new Promise(() => undefined));
    render(
      <PayForm
        account={
          {
            note_pubkey: new Uint8Array(32),
            view_pubkey: new Uint8Array(32),
          } as never
        }
        username="alice"
      />,
    );
    fireEvent.change(screen.getByLabelText("USDC"), {
      target: { value: "100" },
    });
    expect(screen.queryByText(/Olio service fee/)).not.toBeInTheDocument();
  });

  it("does not offer the retired IDR payment method", () => {
    render(<PayForm account={account} username="alice" />);
    expect(screen.queryByRole("button", { name: /Pay with IDR/ })).toBeNull();
    expect(screen.queryByText(/IDR_FORM/)).toBeNull();
  });
});
