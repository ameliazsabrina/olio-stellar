import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { businessIdInput } from "../businesses/businesses.schema";
import { mapVerificationError } from "../verification/verification.router";
import {
  identityPreviewOutput,
  issueStatementInput,
  revokeStatementInput,
  statementListItem,
  statementOutput,
  verifyStatementInput,
  verifyStatementOutput,
} from "./passport.schema";
import { identityPreview } from "./passport.service";
import {
  issueStatement,
  listStatements,
  PassportStatementError,
  revokeStatement,
  verifyStatement,
} from "./passport.statement";

function enforcePublicRateLimit(kind: string, ip: string | null | undefined) {
  const { ok, retryAfterMs } = rateLimit(
    `passport:${kind}:${ip ?? "unknown"}`,
    120,
    60_000,
  );
  if (!ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
    });
  }
}

export function mapStatementError(error: unknown): never {
  if (error instanceof PassportStatementError) {
    throw new TRPCError({
      code:
        error.code === "throttled"
          ? "TOO_MANY_REQUESTS"
          : error.code === "not_found"
            ? "NOT_FOUND"
            : error.code === "too_many_rows"
              ? "BAD_REQUEST"
              : "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  return mapVerificationError(error);
}

export const passportRouter = createTRPCRouter({
  identity: protectedProcedure
    .input(businessIdInput)
    .output(identityPreviewOutput)
    .query(({ ctx, input }) =>
      identityPreview(ctx.privyUserId, input.businessId).catch(
        mapVerificationError,
      ),
    ),
  issueStatement: protectedProcedure
    .input(issueStatementInput)
    .output(statementOutput)
    .mutation(({ ctx, input }) =>
      issueStatement(ctx.privyUserId, input).catch(mapStatementError),
    ),
  listStatements: protectedProcedure
    .input(businessIdInput)
    .output(statementListItem.array())
    .query(({ ctx, input }) =>
      listStatements(ctx.privyUserId, input.businessId).catch(
        mapStatementError,
      ),
    ),
  revokeStatement: protectedProcedure
    .input(revokeStatementInput)
    .output(statementListItem)
    .mutation(({ ctx, input }) =>
      revokeStatement(
        ctx.privyUserId,
        input.businessId,
        input.statementId,
      ).catch(mapStatementError),
    ),
  verifyStatement: publicProcedure
    .input(verifyStatementInput)
    .output(verifyStatementOutput)
    .query(({ ctx, input }) => {
      enforcePublicRateLimit("verify", ctx.ip);
      return verifyStatement(input.statementId);
    }),
});
