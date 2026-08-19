import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.privyUserId || !ctx.privyClaim) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.authError
        ? "Your Privy session is invalid or expired."
        : "Sign in with Privy to continue.",
    });
  }
  return next({
    ctx: {
      ...ctx,
      privyUserId: ctx.privyUserId,
      privyClaim: ctx.privyClaim,
    },
  });
});
