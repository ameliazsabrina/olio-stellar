import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  AnchorBridgeError,
  AnchorChallengeError,
  AnchorConfigError,
} from "./anchor.errors";
import {
  signClientChallengeInput,
  signClientChallengeOutput,
} from "./anchor.schema";
import { signClientChallenge } from "./anchor.service";

const SIGN_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function enforceRateLimit(ip: string | null): void {
  const { ok, retryAfterMs } = rateLimit(
    `anchor:sign:ip:${ip ?? "unknown"}`,
    SIGN_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
    });
  }
}

function mapError(error: unknown): never {
  if (error instanceof AnchorConfigError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  if (error instanceof AnchorBridgeError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (error instanceof AnchorChallengeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

export const anchorRouter = createTRPCRouter({
  signClientChallenge: protectedProcedure
    .input(signClientChallengeInput)
    .output(signClientChallengeOutput)
    .mutation(({ input, ctx }) => {
      enforceRateLimit(ctx.ip);
      return signClientChallenge(input, ctx.privyUserId).catch(mapError);
    }),
});
