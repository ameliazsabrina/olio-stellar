import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { mapBusinessError } from "../businesses/businesses.router";
import {
  VerificationConfigError,
  VerificationDisabledError,
  VerificationProviderError,
  VerificationStateError,
} from "./verification.errors";
import {
  operatorCaseSummary,
  operatorListInput,
  refreshOutput,
  sdkTokenOutput,
  startVerificationInput,
  verificationStatusOutput,
} from "./verification.schema";
import {
  issueSdkToken,
  listCasesForOperator,
  refreshVerification,
  startVerification,
  verificationStatus,
} from "./verification.service";

import { onboarding } from "./verification.submission";

const RATE_WINDOW_MS = 60_000;

function enforceRateLimit(kind: string, limit: number, key: string): void {
  const { ok, retryAfterMs } = rateLimit(
    `verification:${kind}:${key}`,
    limit,
    RATE_WINDOW_MS,
  );
  if (!ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
    });
  }
}

export function mapVerificationError(error: unknown): never {
  if (error instanceof VerificationStateError) {
    throw new TRPCError({
      code:
        error.code === "throttled"
          ? "TOO_MANY_REQUESTS"
          : error.code === "forbidden"
            ? "FORBIDDEN"
            : error.code === "revision_conflict" || error.code === "lease_lost"
              ? "CONFLICT"
              : "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof VerificationProviderError) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
  }
  if (error instanceof VerificationDisabledError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof VerificationConfigError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Identity verification is not configured on this deployment.",
    });
  }
  return mapBusinessError(error);
}

export const verificationRouter = createTRPCRouter({
  onboarding: protectedProcedure
    .input(z.object({ accountKey: z.string().max(128) }).optional())
    .query(({ ctx }) =>
      onboarding(ctx.privyUserId).catch(mapVerificationError),
    ),
  start: protectedProcedure
    .input(startVerificationInput)
    .output(verificationStatusOutput)
    .mutation(({ ctx, input }) => {
      enforceRateLimit("start", 5, ctx.privyUserId);
      return startVerification(ctx.privyUserId, input.businessId).catch(
        mapVerificationError,
      );
    }),
  sdkToken: protectedProcedure
    .input(startVerificationInput)
    .output(sdkTokenOutput)
    .mutation(({ ctx, input }) => {
      enforceRateLimit("token", 20, ctx.privyUserId);
      return issueSdkToken(ctx.privyUserId, input.businessId).catch(
        mapVerificationError,
      );
    }),
  status: protectedProcedure
    .input(startVerificationInput)
    .output(verificationStatusOutput)
    .query(({ ctx, input }) => {
      enforceRateLimit("status", 120, ctx.privyUserId);
      return verificationStatus(ctx.privyUserId, input.businessId).catch(
        mapVerificationError,
      );
    }),
  refresh: protectedProcedure
    .input(startVerificationInput)
    .output(refreshOutput)
    .mutation(({ ctx, input }) => {
      enforceRateLimit("refresh", 10, ctx.privyUserId);
      return refreshVerification(ctx.privyUserId, input.businessId).catch(
        mapVerificationError,
      );
    }),
  operatorCases: protectedProcedure
    .input(operatorListInput)
    .output(operatorCaseSummary.array())
    .query(({ ctx, input }) =>
      listCasesForOperator(ctx.privyUserId, input).catch(mapVerificationError),
    ),
});
