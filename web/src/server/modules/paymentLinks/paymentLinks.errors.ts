export class PaymentLinkStoreError extends Error {
  constructor(id: string) {
    super(`payment link ${id} could not be persisted`);
    this.name = "PaymentLinkStoreError";
  }
}
