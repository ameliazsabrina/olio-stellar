import { describe, expect, it } from "vitest";
import {
  deriveInvoiceState,
  refundSharesByAllocation,
  remainingDue,
} from "../src/server/modules/invoices/invoices.state";
import {
  allocatableAmount,
  qualify,
} from "../src/server/modules/settlements/settlements.policy";

const open = { draft: false, cancelled: false, voided: false };

describe("invoice state projection", () => {
  it("derives issued, partial and paid from allocations net of refunds", () => {
    expect(
      deriveInvoiceState({
        ...open,
        amountDue: 100n,
        allocated: 0n,
        refunded: 0n,
      }),
    ).toBe("issued");
    expect(
      deriveInvoiceState({
        ...open,
        amountDue: 100n,
        allocated: 40n,
        refunded: 0n,
      }),
    ).toBe("partially_paid");
    expect(
      deriveInvoiceState({
        ...open,
        amountDue: 100n,
        allocated: 100n,
        refunded: 0n,
      }),
    ).toBe("paid");
    expect(
      deriveInvoiceState({
        ...open,
        amountDue: 100n,
        allocated: 100n,
        refunded: 30n,
      }),
    ).toBe("partially_paid");
  });

  it("keeps terminal and draft states regardless of payments", () => {
    const paid = { amountDue: 10n, allocated: 10n, refunded: 0n };
    expect(deriveInvoiceState({ ...open, ...paid, cancelled: true })).toBe(
      "cancelled",
    );
    expect(deriveInvoiceState({ ...open, ...paid, voided: true })).toBe("void");
    expect(deriveInvoiceState({ ...open, ...paid, draft: true })).toBe("draft");
  });

  it("never reports a negative remaining amount", () => {
    expect(
      remainingDue({
        amountDue: 10n,
        allocatedAmount: 15n,
        refundedAmount: 0n,
      }),
    ).toBe(0n);
    expect(
      remainingDue({
        amountDue: 10n,
        allocatedAmount: 10n,
        refundedAmount: 4n,
      }),
    ).toBe(4n);
  });
});

describe("refund distribution", () => {
  const allocation = (id: string, amount: bigint, at: number) => ({
    id,
    invoiceId: `inv-${id}`,
    amount,
    createdAt: new Date(at),
  });

  it("consumes the unallocated overpayment before touching invoices", () => {
    const shares = refundSharesByAllocation(
      { amount: 150n, refundedAmount: 50n },
      [allocation("a", 100n, 1)],
    );
    expect(shares.get("a")).toBe(0n);
  });

  it("applies the excess to the newest allocation first", () => {
    const shares = refundSharesByAllocation(
      { amount: 100n, refundedAmount: 70n },
      [allocation("old", 60n, 1), allocation("new", 40n, 2)],
    );
    expect(shares.get("new")).toBe(40n);
    expect(shares.get("old")).toBe(30n);
  });
});

describe("allocation and qualification policy", () => {
  it("allocates no more than the settlement remainder or the invoice remainder", () => {
    expect(
      allocatableAmount({
        settlementAmount: 120n,
        settlementAllocated: 0n,
        invoiceRemaining: 100n,
      }),
    ).toBe(100n);
    expect(
      allocatableAmount({
        settlementAmount: 60n,
        settlementAllocated: 0n,
        invoiceRemaining: 100n,
      }),
    ).toBe(60n);
    expect(
      allocatableAmount({
        settlementAmount: 60n,
        settlementAllocated: 60n,
        invoiceRemaining: 100n,
      }),
    ).toBe(0n);
    expect(
      allocatableAmount({
        settlementAmount: null,
        settlementAllocated: 0n,
        invoiceRemaining: 100n,
      }),
    ).toBe(0n);
  });

  it("does not count self-funded or fully refunded settlements", () => {
    const own = new Set(["GOWN"]);
    expect(
      qualify({
        payer: "GPAYER",
        ownAccounts: own,
        amount: 10n,
        refundedAmount: 0n,
      }),
    ).toMatchObject({ counted: true, selfFunded: false });
    expect(
      qualify({
        payer: "GOWN",
        ownAccounts: own,
        amount: 10n,
        refundedAmount: 0n,
      }),
    ).toMatchObject({ counted: false, selfFunded: true });
    expect(
      qualify({
        payer: "GPAYER",
        ownAccounts: own,
        amount: 10n,
        refundedAmount: 10n,
      }),
    ).toMatchObject({ counted: false, selfFunded: false });
    expect(
      qualify({
        payer: null,
        ownAccounts: own,
        amount: null,
        refundedAmount: 0n,
      }),
    ).toMatchObject({ counted: false });
  });
});
