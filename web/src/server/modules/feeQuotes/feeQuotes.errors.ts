export class FeeQuoteBadRequestError extends Error {}
export class FeeQuoteRecipientNotFoundError extends Error {}
export class FeePolicyUnavailableError extends Error {}
export class FeeQuoteSignerError extends Error {}
export class FeeQuoteRateLimitError extends Error {}
export class FeeQuoteRouteUnavailableError extends Error {
  readonly reason: string;
  readonly retryAfterMs: number;

  constructor(reason: string, retryAfterMs: number) {
    super(
      "This cross-chain route is unavailable. No payment has been initiated.",
    );
    this.name = "FeeQuoteRouteUnavailableError";
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

export class FeeQuoteReadinessError extends Error {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    super("Payment ingress is not ready.");
    this.name = "FeeQuoteReadinessError";
    this.diagnostics = diagnostics;
  }
}
