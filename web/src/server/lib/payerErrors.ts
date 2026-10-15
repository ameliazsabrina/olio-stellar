import { TRPCError } from "@trpc/server";
import { SUBMISSION_REQUIRED } from "../../lib/verification-onboarding";

// Copy shown to payers on /pay. Internal error messages stay detailed for logs
// and service tests; routers translate them here so payers only learn whether
// to wait, retry, or stop.
export const PAYER_MESSAGES = {
  unavailable:
    "Payments are temporarily unavailable. Please try again in a moment.",
  busy: "Too many attempts. Please wait a minute and try again.",
  recipientNotFound: "We couldn't find this recipient.",
  recipientNotReady: "This recipient can't receive payments yet.",
  invalidRequest:
    "Something went wrong preparing this payment. Refresh the page and try again.",
} as const;

export function tooManyAttempts(retryAfterMs: number): TRPCError {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message:
      seconds > 1
        ? `Too many attempts. Please try again in ${seconds} seconds.`
        : PAYER_MESSAGES.busy,
  });
}

/** Rewrite TRPCErrors raised below the router; anything else becomes a generic outage. */
export function toPayerError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    if (error.message === SUBMISSION_REQUIRED)
      return new TRPCError({
        code: error.code,
        message: PAYER_MESSAGES.recipientNotReady,
      });
    return error;
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: PAYER_MESSAGES.unavailable,
    cause: error,
  });
}
