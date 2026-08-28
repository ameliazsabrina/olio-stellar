import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { currentWallet } from "../wallets/wallets.service";
import { BridgeConfigError, BridgeFundError } from "./bridge.errors";
import { fundBridgeInput, fundBridgeOutput } from "./bridge.schema";
import { fundBridge, fundUserWallet } from "./bridge.service";

const FUND_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function enforceRateLimit(ip: string | null): void {
  const { ok, retryAfterMs } = rateLimit(
    `bridge:fund:ip:${ip ?? "unknown"}`,
    FUND_LIMIT,
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
  if (error instanceof BridgeConfigError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  if (error instanceof BridgeFundError) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
  }
  throw error;
}

export const bridgeRouter = createTRPCRouter({
  fund: publicProcedure
    .input(fundBridgeInput)
    .output(fundBridgeOutput)
    .mutation(({ input, ctx }) => {
      enforceRateLimit(ctx.ip);
      return fundBridge(input).catch(mapError);
    }),
  fundWallet: protectedProcedure
    .input(fundBridgeInput)
    .output(fundBridgeOutput)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.ip);
      const wallet = await currentWallet(ctx.privyUserId);
      if (!wallet || wallet.privyWalletAddress !== input.bridgePublicKey) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The funding account is not your Privy Stellar wallet.",
        });
      }
      return fundUserWallet(input).catch(mapError);
    }),
});
