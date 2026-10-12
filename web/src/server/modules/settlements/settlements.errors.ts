export class SettlementNotFoundError extends Error {
  constructor() {
    super("Settlement not found.");
    this.name = "SettlementNotFoundError";
  }
}

export type SettlementStateReason =
  | "amount_unknown"
  | "withdrawal_not_indexed"
  | "withdrawal_already_claimed"
  | "refund_exceeds"
  | "not_indexed"
  | "index_gap"
  | "not_reconciled"
  | "no_keys"
  | "opening_mismatch"
  | "attributed_elsewhere"
  | "business_inactive"
  | "network_mismatch";

const STATE_MESSAGES: Record<SettlementStateReason, string> = {
  amount_unknown: "This settlement has no verified amount yet.",
  withdrawal_not_indexed:
    "That withdrawal has not been indexed yet. Try again in a minute.",
  withdrawal_already_claimed:
    "That withdrawal is already recorded as a refund for another payment.",
  refund_exceeds: "The refund is larger than the unrefunded amount.",
  not_indexed: "That payment has not been indexed yet.",
  index_gap:
    "That payment falls in an indexer gap and cannot be claimed. It has been reported.",
  not_reconciled:
    "That payment has not been reconciled yet. Try again in a minute.",
  no_keys: "No payment keys are recorded for this business yet.",
  opening_mismatch: "The note details do not match this business's keys.",
  attributed_elsewhere: "That payment is attributed to another business.",
  business_inactive: "This business is not active.",
  network_mismatch: "That payment belongs to a different network or pool.",
};

export class SettlementStateError extends Error {
  constructor(public readonly reason: SettlementStateReason) {
    super(STATE_MESSAGES[reason]);
    this.name = "SettlementStateError";
  }
}
