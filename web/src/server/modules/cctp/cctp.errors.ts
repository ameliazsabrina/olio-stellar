export class CctpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpConfigError";
  }
}

export class CctpPayeeError extends Error {
  constructor(username: string) {
    super(`no Olio account resolves for @${username}`);
    this.name = "CctpPayeeError";
  }
}

export class CctpAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpAttestationError";
  }
}

export class CctpRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpRelayError";
  }
}

export type CctpErrorCode = "timeout" | "throttled" | "denied" | "upstream" | "transport" | "malformed" | "unsupported" | "configuration" | "lease_lost" | "pending" | "unauthorized" | "binding";
export class CctpOperationalError extends Error {
  constructor(public readonly code: CctpErrorCode, public readonly retryAfterMs = 30_000) {
    super(code === "unauthorized" ? "Payment recovery authorization is invalid." : code === "binding" ? "Payment evidence does not match the accepted quote." : "Cross-chain payment service is temporarily unavailable. Existing payments remain recoverable.");
    this.name = "CctpOperationalError";
  }
}
