import { x25519 } from "@noble/curves/ed25519.js";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentCommitment,
  encryptInvoice,
  type InvoiceContent,
  newInvoiceKey,
  wrapKeyToView,
} from "../src/lib/invoiceCrypto";

const mocks = vi.hoisted(() => ({
  accountUnlocked: true,
  viewSk: null as Uint8Array | null,
  items: [] as Record<string, unknown>[],
  promptUnlock: vi.fn(),
}));

vi.mock("../src/features/verification/useVerification", () => ({
  useVerification: () => ({
    business: { businessId: "biz_1", role: "owner" },
    businessesLoading: false,
  }),
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    username: "acme",
    accountUnlocked: mocks.accountUnlocked,
    promptUnlock: mocks.promptUnlock,
  }),
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: () =>
    mocks.viewSk ? { ownerSecret: 1n, viewSk: mocks.viewSk } : null,
}));
vi.mock("../src/features/paymentLinks/hooks/usePaymentLink", () => ({
  usePaymentLinksByOwner: () => ({ links: [], refresh: vi.fn() }),
}));
vi.mock("../src/features/verification/openVerification", () => ({
  openVerification: vi.fn(),
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      invoices: { get: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
    }),
    invoices: {
      list: {
        useQuery: () => ({
          data: { items: mocks.items, nextBeforeNumber: null },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      get: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
    },
  },
}));

import { InvoicesDashboard } from "../src/components/dashboard/InvoicesDashboard";

const content: InvoiceContent = {
  customer: { name: "Globex Corp", email: null, address: null },
  lineItems: [
    { description: "Retainer", quantity: 1, unitPrice: "1000000000" },
  ],
  notes: null,
  salt: "12".repeat(32),
};

function summary(
  viewPubkey: Uint8Array,
  overrides: Record<string, unknown> = {},
) {
  const key = newInvoiceKey();
  return {
    invoiceId: "inv_00000001",
    businessId: "biz_1",
    number: 1,
    state: "partially_paid",
    currentVersion: 1,
    amountDue: "1000000000",
    allocatedAmount: "400000000",
    refundedAmount: "0",
    paidAmount: "400000000",
    remainingAmount: "600000000",
    issuedAt: "2026-10-01T00:00:00.000Z",
    cancelledAt: null,
    erased: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    current: {
      version: 1,
      network: "testnet",
      poolId: "CPOOL",
      asset: "CUSDC",
      amountDue: "1000000000",
      issuedAt: "2026-10-01T00:00:00.000Z",
      dueAt: "2026-10-31T23:59:59.000Z",
      encryptedContent: encryptInvoice(content, key),
      wrappedKey: wrapKeyToView(key, viewPubkey),
      contentCommitment: contentCommitment(content),
      invoiceCommitment: "00".repeat(32),
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

beforeEach(() => {
  const viewSk = x25519.utils.randomSecretKey();
  mocks.viewSk = viewSk;
  mocks.accountUnlocked = true;
  mocks.items = [summary(x25519.getPublicKey(viewSk))];
});

describe("InvoicesDashboard", () => {
  it("decrypts customer details locally and shows the outstanding amount", async () => {
    render(<InvoicesDashboard />);
    const list = screen
      .getByRole("heading", { name: "All invoices" })
      .closest("section") as HTMLElement;
    expect(await within(list).findByText(/Globex Corp/)).toBeInTheDocument();
    expect(within(list).getByText("INV-0001")).toBeInTheDocument();
    expect(within(list).getByText("Partially paid")).toBeInTheDocument();
    expect(screen.getByText("60 USDC")).toBeInTheDocument();
  });

  it("filters by state", async () => {
    const user = userEvent.setup();
    render(<InvoicesDashboard />);
    await user.click(screen.getByRole("button", { name: "Paid" }));
    expect(
      screen.getByText("No invoices match this filter."),
    ).toBeInTheDocument();
  });

  it("keeps details encrypted until the account is unlocked", async () => {
    const user = userEvent.setup();
    mocks.accountUnlocked = false;
    render(<InvoicesDashboard />);
    expect(screen.getByText(/Encrypted details/)).toBeInTheDocument();
    expect(screen.queryByText(/Globex Corp/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(mocks.promptUnlock).toHaveBeenCalled();
  });
});
