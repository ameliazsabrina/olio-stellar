// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDisclosure: vi.fn(),
  createPaymentLink: vi.fn(),
  scanMyNotes: vi.fn(),
  verifyDisclosure: vi.fn(),
}));

vi.mock("../src/features/paymentLinks/hooks/useCreatePaymentLink", () => ({
  useCreatePaymentLink: () => ({
    createPaymentLink: mocks.createPaymentLink,
    isCreating: false,
  }),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ username: "olive" }),
}));

vi.mock("../src/lib/notes", () => ({
  getAccount: () => ({ ownerSecret: 1n }),
  scanMyNotes: mocks.scanMyNotes,
}));

vi.mock("../src/lib/disclosure", () => ({
  buildDisclosure: mocks.buildDisclosure,
  verifyDisclosure: mocks.verifyDisclosure,
}));

vi.mock("../src/lib/disclosurePdf", () => ({
  downloadDisclosurePdf: vi.fn(),
}));

import { DiscloseDialog } from "../src/components/dashboard/DiscloseDialog";
import { ReceiveDialog } from "../src/components/dashboard/ReceiveDialog";

describe("dashboard glass modals", () => {
  it("uses primary, supporting, and disabled roles on receive options", () => {
    render(
      <ReceiveDialog
        open
        onClose={vi.fn()}
        username="olive"
        origin="https://example.test"
      />,
    );

    const primaryOption = screen.getByRole("button", {
      name: /Create a link or QR/,
    });
    const disabledOption = screen.getByRole("button", {
      name: /Request from a username/,
    });

    expect(primaryOption).toHaveClass("rounded-2xl");
    expect(within(primaryOption).getByText("Create a link or QR")).toHaveClass(
      "text-brand-linen",
    );
    expect(
      within(primaryOption).getByText(
        "Share a link, with an amount, or open-ended",
      ),
    ).toHaveClass("text-brand-linen/60");
    expect(disabledOption).toBeDisabled();
    expect(disabledOption).toHaveClass("rounded-2xl", "text-brand-linen/45");

    fireEvent.click(primaryOption);
    expect(screen.getByLabelText(/Description/)).toHaveClass("rounded-xl");
    expect(screen.getByText("Link name")).toHaveClass("text-brand-linen/70");
  });

  it("uses glass receipt roles and a nested-card radius when ready", async () => {
    const bundle = {
      version: 1,
      pool: "pool",
      network: "network",
      leafIndex: 7,
      commitmentHex: "00",
      commitment: "0",
      rootHex: "00",
      root: "0",
      amount: "12500000",
      amountLabel: "1.25",
      ownerPk: "1",
      salt: "2",
      pathElements: [],
      pathIndices: [],
      username: "olive",
      disclosedAt: "2026-08-09T00:00:00.000Z",
    };
    mocks.scanMyNotes.mockResolvedValue({
      notes: [{ leafIndex: 7, amount: 12_500_000n, salt: 2n }],
    });
    mocks.buildDisclosure.mockResolvedValue(bundle);
    mocks.verifyDisclosure.mockResolvedValue({ valid: true });

    render(<DiscloseDialog open onClose={vi.fn()} leafIndex={7} />);

    const value = await screen.findByText("1.25 USDC");
    const card =
      screen.getByText("Payment received").parentElement?.parentElement;

    expect(value).toHaveClass("text-brand-linen");
    expect(screen.getByText("Payment received")).toHaveClass(
      "text-brand-linen/65",
    );
    expect(screen.getByText("Recipient")).toHaveClass("text-brand-linen/65");
    expect(card).toHaveClass("rounded-2xl");
  });
});
