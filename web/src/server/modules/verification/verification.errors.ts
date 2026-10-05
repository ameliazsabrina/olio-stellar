export class VerificationConfigError extends Error {
  constructor(message = "Identity verification is not configured.") {
    super(message);
    this.name = "VerificationConfigError";
  }
}

export class VerificationDisabledError extends Error {
  constructor() {
    super("Identity verification is not available on this deployment yet.");
    this.name = "VerificationDisabledError";
  }
}

export type ProviderErrorCode =
  | "timeout"
  | "throttled"
  | "denied"
  | "upstream"
  | "transport"
  | "malformed"
  | "not_found"
  | "ambiguous";

const RETRYABLE: ProviderErrorCode[] = [
  "timeout",
  "throttled",
  "upstream",
  "transport",
  "ambiguous",
];

export class VerificationProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly retryAfterMs = 30_000,
    public readonly status: number | null = null,
  ) {
    super("Identity verification is briefly unavailable. Try again shortly.");
    this.name = "VerificationProviderError";
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

export type VerificationStateCode =
  | "no_case"
  | "not_bound"
  | "lease_lost"
  | "revision_conflict"
  | "throttled"
  | "environment_mismatch"
  | "closed"
  | "forbidden"
  | "not_publishable";

export class VerificationStateError extends Error {
  constructor(
    public readonly code: VerificationStateCode,
    public readonly retryAfterMs = 0,
  ) {
    super(
      code === "no_case"
        ? "Start verification before requesting a session."
        : code === "not_bound"
          ? "Link your Olio account to this business before verifying."
          : code === "throttled"
            ? "Too many requests. Try again in a moment."
            : code === "closed"
              ? "This business profile is not active."
              : code === "forbidden"
                ? "You do not have permission to perform this action."
                : code === "not_publishable"
                  ? "Your identity badge can be published once verification is approved and current."
                  : "Verification state changed. Refresh and try again.",
    );
    this.name = "VerificationStateError";
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof VerificationProviderError) return error.retryable;
  if (error instanceof VerificationStateError) {
    return error.code === "lease_lost" || error.code === "revision_conflict";
  }
  return false;
}
