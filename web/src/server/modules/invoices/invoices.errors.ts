export class InvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice not found.");
    this.name = "InvoiceNotFoundError";
  }
}

export type InvoiceStateReason =
  | "not_payable"
  | "not_revisable"
  | "has_allocations"
  | "payment_in_progress"
  | "not_cancellable"
  | "not_draft"
  | "business_inactive"
  | "account_unbound"
  | "wrong_recipient"
  | "network_mismatch"
  | "erased";

const STATE_MESSAGES: Record<InvoiceStateReason, string> = {
  not_payable: "This invoice is not open for payment.",
  not_revisable: "Only draft or unpaid invoices can be revised.",
  has_allocations:
    "This invoice already has payments applied. Cancel it and issue a new one instead.",
  payment_in_progress:
    "A payment for this invoice is in progress. Try again after it settles or expires.",
  not_cancellable: "This invoice can no longer be cancelled.",
  not_draft: "Only draft invoices can be issued.",
  business_inactive: "This business is not active.",
  account_unbound: "Link your Olio account to this business before invoicing.",
  wrong_recipient: "This invoice belongs to a different recipient.",
  network_mismatch: "This invoice was issued on a different network or pool.",
  erased: "This invoice's details were erased.",
};

export class InvoiceStateError extends Error {
  constructor(public readonly reason: InvoiceStateReason) {
    super(STATE_MESSAGES[reason]);
    this.name = "InvoiceStateError";
  }
}

export class InvoiceConflictError extends Error {
  constructor() {
    super("The invoice changed. Reload it and try again.");
    this.name = "InvoiceConflictError";
  }
}

export class InvoiceConfigError extends Error {
  constructor() {
    super("Invoicing is not configured for this network.");
    this.name = "InvoiceConfigError";
  }
}
