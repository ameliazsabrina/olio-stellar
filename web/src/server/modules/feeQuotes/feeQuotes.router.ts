import { TRPCError } from "@trpc/server";
import { PAYER_MESSAGES, toPayerError } from "../../lib/payerErrors";
import { __resetRateLimit, rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  InvoiceConfigError,
  InvoiceConflictError,
  InvoiceNotFoundError,
  InvoiceStateError,
  type InvoiceStateReason,
} from "../invoices/invoices.errors";
import {
  FeePolicyUnavailableError,
  FeeQuoteBadRequestError,
  FeeQuoteRateLimitError,
  FeeQuoteReadinessError,
  FeeQuoteRecipientNotFoundError,
  FeeQuoteRouteUnavailableError,
  FeeQuoteSignerError,
} from "./feeQuotes.errors";
import {
  assertPaymentIngressReady,
  getCachedFeeQuoteReadiness,
} from "./feeQuotes.readiness";
import {
  issueInput,
  issueOutput,
  previewInput,
  previewOutput,
} from "./feeQuotes.schema";
import { issueFeeQuote, previewFeeQuote } from "./feeQuotes.service";

function enforceQuoteRateLimit(
  ip: string | null,
  kind: "preview" | "issue",
): void {
  const limit = kind === "preview" ? 60 : 15;
  const key = `${kind}:${ip ?? "unknown"}`;
  if (!rateLimit(key, limit, 60_000).ok) {
    throw new FeeQuoteRateLimitError("Too many quote requests.");
  }
}

export function resetFeeQuoteRateLimitsForTests(): void {
  if (process.env.NODE_ENV === "test") __resetRateLimit();
}

// Only /pay calls this router, so every message below is payer-facing copy.
const INVOICE_STATE_MESSAGES: Partial<Record<InvoiceStateReason, string>> = {
  not_payable: "This invoice is not open for payment.",
  payment_in_progress:
    "Another payment for this invoice is processing. Please wait and try again.",
  business_inactive: "This business can't receive payments right now.",
  account_unbound: "This business can't receive payments right now.",
};

function mapError(error: unknown): never {
  if (error instanceof FeeQuoteBadRequestError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.publicMessage ?? PAYER_MESSAGES.invalidRequest,
      cause: error,
    });
  }
  if (error instanceof RangeError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This amount can't be paid from this network. Try a slightly different amount.",
      cause: error,
    });
  }
  if (error instanceof FeeQuoteRecipientNotFoundError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: PAYER_MESSAGES.recipientNotFound,
    });
  }
  if (
    error instanceof FeePolicyUnavailableError ||
    error instanceof FeeQuoteSignerError
  ) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: PAYER_MESSAGES.unavailable,
      cause: error,
    });
  }
  if (error instanceof FeeQuoteRouteUnavailableError) {
    // A closed route is a precondition, not a fault: the readiness reason is
    // carried as the cause so it is logged without leaking to the caller.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Payments from this network aren't available right now. You haven't been charged.",
      cause: error,
    });
  }
  if (error instanceof FeeQuoteReadinessError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: PAYER_MESSAGES.unavailable,
      cause: error,
    });
  }
  if (error instanceof FeeQuoteRateLimitError) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: PAYER_MESSAGES.busy,
    });
  }
  if (error instanceof InvoiceNotFoundError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "We couldn't find this invoice.",
    });
  }
  if (error instanceof InvoiceStateError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        INVOICE_STATE_MESSAGES[error.reason] ??
        "This invoice can't be paid here.",
      cause: error,
    });
  }
  if (error instanceof InvoiceConfigError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invoice payments are temporarily unavailable.",
      cause: error,
    });
  }
  if (error instanceof InvoiceConflictError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This invoice was just updated. Reload the page and try again.",
    });
  }
  throw toPayerError(error);
}

export const feeQuotesRouter = createTRPCRouter({
  readiness: publicProcedure.query(async () => {
    const report = await getCachedFeeQuoteReadiness();
    return {
      checkedAt: report.checkedAt,
      network: report.network,
      channels: report.channels,
      diagnostics: report.diagnostics.map(({ code, severity, channels }) => ({
        code,
        severity,
        channels,
      })),
    };
  }),
  preview: publicProcedure
    .input(previewInput)
    .output(previewOutput)
    .query(async ({ ctx, input }) => {
      try {
        enforceQuoteRateLimit(ctx.ip, "preview");
        await assertPaymentIngressReady(input.channel);
        return await previewFeeQuote(input);
      } catch (error) {
        return mapError(error);
      }
    }),
  issue: publicProcedure
    .input(issueInput)
    .output(issueOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        enforceQuoteRateLimit(ctx.ip, "issue");
        await assertPaymentIngressReady(input.channel);
        return await issueFeeQuote(input, ctx.privyUserId);
      } catch (error) {
        return mapError(error);
      }
    }),
});
