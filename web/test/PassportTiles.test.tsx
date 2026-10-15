// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: null as null | Record<string, unknown>,
  status: null as null | Record<string, unknown>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  setData: vi.fn(),
  statements: [] as Record<string, unknown>[],
  issueStatement: vi.fn(),
  revokeStatement: vi.fn(),
  invalidateStatements: vi.fn(),
  downloadPassportPdf: vi.fn(),
}));

vi.mock("../src/features/verification/useVerification", () => ({
  useVerification: () => ({
    business: { businessId: "biz_1", type: "individual" },
    businessesLoading: false,
    status: mocks.status,
  }),
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ username: "alice" }),
}));
vi.mock("../src/lib/passportPdf", () => ({
  downloadPassportPdf: mocks.downloadPassportPdf,
}));
vi.mock("../src/lib/qrImage", () => ({
  qrPngDataUrl: async () => "data:image/png;base64,QR",
}));
vi.mock("../src/lib/stellar", () => ({
  explorerTxUrl: (hash: string) => `https://explorer/${hash}`,
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      passport: {
        identity: { setData: mocks.setData },
        listStatements: { invalidate: mocks.invalidateStatements },
      },
    }),
    passport: {
      identity: {
        useQuery: () => ({
          data: mocks.preview,
          isLoading: false,
        }),
      },
      listStatements: {
        useQuery: () => ({ data: mocks.statements }),
      },
      issueStatement: {
        useMutation: () => ({ mutateAsync: mocks.issueStatement }),
      },
      revokeStatement: {
        useMutation: () => ({
          mutateAsync: mocks.revokeStatement,
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import {
  badgeStateFor,
  PassportTiles,
} from "../src/components/dashboard/PassportTiles";

function credential(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    issuer: "olio",
    policyVersion: 1,
    checkedAt: "2026-09-21T10:00:00.000Z",
    validUntil: "2027-09-21T10:00:00.000Z",
    published: false,
    environment: "sandbox",
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    businessId: "biz_1",
    publicId: "pub_abcdef",
    displayName: "Alice",
    type: "individual",
    credential: credential(),
    publishable: true,
    publicPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = preview();
  mocks.status = { eligibility: "approved" };
  mocks.statements = [];
  mocks.issueStatement.mockResolvedValue({
    statement: { statementId: "pst_AAAAAAAAAAAAAAAAAAAAAA" },
    digest: "ab".repeat(32),
    verifyPath: "/verify/pst_AAAAAAAAAAAAAAAAAAAAAA",
  });
  mocks.revokeStatement.mockResolvedValue({});
  mocks.downloadPassportPdf.mockResolvedValue(undefined);
});

function statementItem(overrides: Record<string, unknown> = {}) {
  return {
    statementId: "pst_AAAAAAAAAAAAAAAAAAAAAA",
    status: "valid",
    period: {
      preset: "12m",
      from: "2025-11-01T00:00:00.000Z",
      to: "2026-10-15T09:00:00.000Z",
    },
    detail: "summary",
    payerMask: null,
    summary: {
      totalReceived: "100000000",
      paymentCount: 1,
      distinctPayers: 1,
      excludedCount: 0,
    },
    digest: "ab".repeat(32),
    issuedAt: "2026-10-15T09:00:00.000Z",
    expiresAt: "2027-01-13T09:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

describe("badge state mapping", () => {
  it("maps credential status to the badge state", () => {
    expect(badgeStateFor(null)).toBe("none");
    expect(badgeStateFor(undefined)).toBe("none");
    expect(badgeStateFor({ status: "active" })).toBe("verified");
    expect(badgeStateFor({ status: "suspended" })).toBe("suspended");
    expect(badgeStateFor({ status: "expired" })).toBe("expired");
  });
});

describe("passport status", () => {
  it("offers no badge preview or publishing controls", () => {
    render(<PassportTiles />);
    expect(screen.queryByTestId("identity-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-identity-url")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Publish badge|Hide badge/ }),
    ).not.toBeInTheDocument();
  });

  it("explains when an unverified user's passport PDF unlocks", () => {
    mocks.preview = preview({ credential: null, publishable: false });
    mocks.status = { eligibility: "pending" };
    render(<PassportTiles />);
    expect(
      screen.getByText(/available once identity verification is approved/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Payment statement" }),
    ).not.toBeInTheDocument();
  });
});

describe("passport PDF", () => {
  it("offers the download only once the badge is verified", () => {
    mocks.preview = preview({
      credential: credential({ status: "suspended" }),
      publishable: false,
    });
    const { unmount } = render(<PassportTiles />);
    expect(
      screen.queryByRole("region", { name: "Payment statement" }),
    ).not.toBeInTheDocument();
    unmount();
    mocks.preview = preview();
    render(<PassportTiles />);
    expect(
      screen.getByRole("region", { name: "Payment statement" }),
    ).toHaveTextContent(/Only people you send this file to/);
  });

  it("downloads a monthly summary for 12 months by default", async () => {
    render(<PassportTiles />);
    await userEvent.click(screen.getByRole("button", { name: /^Download$/ }));
    expect(
      screen.getByRole("button", { name: "Monthly summary" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "12 months" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("group", { name: "Payer addresses" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() =>
      expect(mocks.downloadPassportPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          verifyUrl: `${window.location.origin}/verify/pst_AAAAAAAAAAAAAAAAAAAAAA`,
          username: "alice",
          qr: "data:image/png;base64,QR",
        }),
      ),
    );
    expect(mocks.issueStatement).toHaveBeenCalledWith({
      businessId: "biz_1",
      detail: "summary",
      period: "12m",
      payerMask: "masked",
    });
    expect(mocks.invalidateStatements).toHaveBeenCalledWith({
      businessId: "biz_1",
    });
  });

  it("asks how to show payers only for a full list", async () => {
    render(<PassportTiles />);
    await userEvent.click(screen.getByRole("button", { name: /^Download$/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Full payment list" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    await userEvent.click(screen.getByRole("button", { name: "Hidden" }));
    await userEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() =>
      expect(mocks.issueStatement).toHaveBeenCalledWith({
        businessId: "biz_1",
        detail: "full",
        period: "all",
        payerMask: "hidden",
      }),
    );
  });

  it("shows why a statement could not be issued", async () => {
    mocks.issueStatement.mockRejectedValue(
      new Error(
        "Payments after 2026-10-15 14:02 UTC are still syncing. Try again in a few minutes.",
      ),
    );
    render(<PassportTiles />);
    await userEvent.click(screen.getByRole("button", { name: /^Download$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still syncing/);
    expect(mocks.downloadPassportPdf).not.toHaveBeenCalled();
  });

  it("revokes an issued statement after confirmation", async () => {
    mocks.statements = [statementItem()];
    render(<PassportTiles />);
    const list = screen.getByRole("list", { name: "Issued statements" });
    expect(list).toHaveTextContent("Monthly summary · 12 months");
    await userEvent.click(
      screen.getByRole("button", {
        name: "Revoke statement pst_AAAAAAAAAAAAAAAAAAAAAA",
      }),
    );
    expect(mocks.revokeStatement).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm revoke" }),
    );
    await waitFor(() =>
      expect(mocks.revokeStatement).toHaveBeenCalledWith({
        businessId: "biz_1",
        statementId: "pst_AAAAAAAAAAAAAAAAAAAAAA",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Statement revoked");
  });

  it("shows revoked and expired statements without a revoke action", () => {
    mocks.statements = [
      statementItem({ status: "revoked", revokedAt: "2026-10-16T00:00:00Z" }),
      statementItem({
        statementId: "pst_BBBBBBBBBBBBBBBBBBBBBB",
        status: "expired",
      }),
    ];
    render(<PassportTiles />);
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
    expect(screen.getAllByTestId("passport-statement")).toHaveLength(2);
  });
});
