import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentCommitment,
  encryptInvoice,
  type InvoiceContent,
  keyToFragment,
  newInvoiceKey,
} from "../src/lib/invoiceCrypto";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  publicView: vi.fn(),
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    feeQuotes: {
      preview: { query: mocks.preview },
      issue: { mutate: vi.fn() },
    },
    invoices: { publicView: { query: mocks.publicView } },
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

const content: InvoiceContent = {
  customer: { name: "Globex Corp", email: null, address: null },
  lineItems: [{ description: "Retainer", quantity: 2, unitPrice: "500000000" }],
  notes: null,
  salt: "34".repeat(32),
};

const link = {
  id: "link_1",
  owner: "alice",
  slug: "inv-0001-abcd",
  amount: null,
  description: "Invoice INV-0001",
  label: "Invoice INV-0001",
  status: "pending",
  state: "active",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: null,
  archivedAt: null,
  businessClaimed: false,
  verifiedBusinessPublicId: null,
  invoiceId: "inv_00000001",
} as const;

function publicInvoice(
  key: Uint8Array,
  overrides: Record<string, unknown> = {},
) {
  return {
    invoiceId: "inv_00000001",
    number: 1,
    version: 2,
    state: "partially_paid",
    payable: true,
    amountDue: "1000000000",
    remainingAmount: "600000000",
    network: "testnet",
    asset: "CUSDC",
    issuedAt: "2026-10-01T00:00:00.000Z",
    dueAt: null,
    encryptedContent: encryptInvoice(content, key),
    contentCommitment: contentCommitment(content),
    invoiceCommitment: "00".repeat(32),
    business: { displayName: "Acme", verifiedPublicId: null },
    ...overrides,
  };
}

describe("PayForm with an invoice-bound link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("decrypts the invoice from the fragment and locks the remaining amount", async () => {
    const key = newInvoiceKey();
    window.location.hash = keyToFragment(key);
    mocks.publicView.mockResolvedValue(publicInvoice(key));
    render(<PayForm account={account} username="alice" link={link} />);

    expect(await screen.findByText("Globex Corp")).toBeInTheDocument();
    expect(screen.getByText("Retainer")).toBeInTheDocument();
    expect(mocks.publicView).toHaveBeenCalledWith({
      invoiceId: "inv_00000001",
    });
    await waitFor(() =>
      expect(screen.getByLabelText("USDC")).toHaveValue("60"),
    );
    expect(screen.getByLabelText("USDC")).toHaveAttribute("readonly");
  });

  it("keeps line items encrypted when the link lacks its key", async () => {
    mocks.publicView.mockResolvedValue(publicInvoice(newInvoiceKey()));
    render(<PayForm account={account} username="alice" link={link} />);
    expect(
      await screen.findByText(/missing its private key/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Globex Corp")).not.toBeInTheDocument();
  });

  it("refuses a decryption that does not match the issued commitment", async () => {
    const key = newInvoiceKey();
    window.location.hash = keyToFragment(key);
    mocks.publicView.mockResolvedValue(
      publicInvoice(key, { contentCommitment: "ff".repeat(32) }),
    );
    render(<PayForm account={account} username="alice" link={link} />);
    expect(
      await screen.findByText(/could not be verified/),
    ).toBeInTheDocument();
  });

  it("tells the payer when the invoice is already paid", async () => {
    const key = newInvoiceKey();
    mocks.publicView.mockResolvedValue(
      publicInvoice(key, {
        state: "paid",
        payable: false,
        remainingAmount: "0",
      }),
    );
    render(<PayForm account={account} username="alice" link={link} />);
    expect(
      await screen.findByText("This invoice is paid in full."),
    ).toBeInTheDocument();
  });
});
