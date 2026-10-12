import type { SettlementQualification } from "../../db/mongo";

export const QUALIFICATION_POLICY_VERSION = 1;
export const EVIDENCE_VERSION = 1;

export function qualify(input: {
  payer: string | null;
  ownAccounts: ReadonlySet<string>;
  amount: bigint | null;
  refundedAmount: bigint;
}): SettlementQualification {
  const selfFunded = input.payer !== null && input.ownAccounts.has(input.payer);
  const fullyRefunded =
    input.amount !== null && input.refundedAmount >= input.amount;
  return {
    counted: input.amount !== null && !selfFunded && !fullyRefunded,
    selfFunded,
    policyVersion: QUALIFICATION_POLICY_VERSION,
  };
}

export function settlementIdFor(
  network: string,
  poolId: string,
  leafIndex: number,
): string {
  return `${network}:${poolId}:${leafIndex}`;
}

export function allocationIdFor(
  settlementId: string,
  invoiceId: string,
  invoiceVersion: number,
): string {
  return `${settlementId}:${invoiceId}:${invoiceVersion}`;
}

export function allocatableAmount(input: {
  settlementAmount: bigint | null;
  settlementAllocated: bigint;
  invoiceRemaining: bigint;
}): bigint {
  if (input.settlementAmount === null) return 0n;
  const unallocated = input.settlementAmount - input.settlementAllocated;
  const amount =
    unallocated < input.invoiceRemaining ? unallocated : input.invoiceRemaining;
  return amount > 0n ? amount : 0n;
}
