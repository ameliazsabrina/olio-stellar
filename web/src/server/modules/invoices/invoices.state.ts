import type { InvoiceState } from "../../db/mongo";

export const I64_MAX = (1n << 63n) - 1n;

export type ProjectionAllocation = {
  id: string;
  invoiceId: string;
  amount: bigint;
  createdAt: Date;
};

export function refundSharesByAllocation(
  settlement: { amount: bigint | null; refundedAmount: bigint },
  allocations: ProjectionAllocation[],
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  const allocated = allocations.reduce((sum, a) => sum + a.amount, 0n);
  const amount = settlement.amount ?? allocated;
  const unallocated = amount > allocated ? amount - allocated : 0n;
  let excess =
    settlement.refundedAmount > unallocated
      ? settlement.refundedAmount - unallocated
      : 0n;
  const newestFirst = [...allocations].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
  for (const allocation of newestFirst) {
    const share = excess < allocation.amount ? excess : allocation.amount;
    shares.set(allocation.id, share);
    excess -= share;
  }
  return shares;
}

export function deriveInvoiceState(input: {
  draft: boolean;
  cancelled: boolean;
  voided: boolean;
  amountDue: bigint;
  allocated: bigint;
  refunded: bigint;
}): InvoiceState {
  if (input.voided) return "void";
  if (input.cancelled) return "cancelled";
  if (input.draft) return "draft";
  const paid = input.allocated - input.refunded;
  if (paid <= 0n) return "issued";
  if (paid < input.amountDue) return "partially_paid";
  return "paid";
}

export function remainingDue(invoice: {
  amountDue: bigint;
  allocatedAmount: bigint;
  refundedAmount: bigint;
}): bigint {
  const remaining =
    invoice.amountDue - (invoice.allocatedAmount - invoice.refundedAmount);
  return remaining > 0n ? remaining : 0n;
}

export const PAYABLE_STATES: InvoiceState[] = ["issued", "partially_paid"];
export const REVISABLE_STATES: InvoiceState[] = ["draft", "issued"];
