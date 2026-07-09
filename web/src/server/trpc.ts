import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { privyConfigured, verifyUser } from "./modules/privy/privy.service";

const t = initTRPC.context<Context>().create();

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!privyConfigured) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Privy not configured",
    });
  }
  if (!ctx.token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "missing token" });
  }
  try {
    const userId = await verifyUser(ctx.token);
    return next({ ctx: { ...ctx, userId } });
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid token" });
  }
});
