import { TRPCError } from "@trpc/server";
import { __resetRateLimit, rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
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

function mapError(error: unknown): never {
  if (error instanceof FeeQuoteBadRequestError || error instanceof RangeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof FeeQuoteRecipientNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof FeePolicyUnavailableError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  if (error instanceof FeeQuoteSignerError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Fee quoting is unavailable.",
    });
  }
  if (error instanceof FeeQuoteRouteUnavailableError) {
    // A closed route is a precondition, not a fault: the readiness reason is
    // carried as the cause so it is logged without leaking to the caller.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof FeeQuoteReadinessError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Payment quoting is unavailable.",
    });
  }
  if (error instanceof FeeQuoteRateLimitError) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
  }
  throw error;
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
