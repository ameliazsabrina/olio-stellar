export class PaymentLinkStoreError extends Error {
  constructor(id: string) {
    super(`payment link ${id} could not be persisted`);
    this.name = "PaymentLinkStoreError";
  }
}

export class PaymentLinkSlugUnavailableError extends Error {
  constructor(slug: string) {
    super(`payment link slug "${slug}" is already in use`);
    this.name = "PaymentLinkSlugUnavailableError";
  }
}

// One error for both not-found and bad-token so callers get no existence oracle.
export class PaymentLinkUnauthorizedError extends Error {
  constructor() {
    super("payment link cannot be managed with the provided credentials");
    this.name = "PaymentLinkUnauthorizedError";
  }
}
