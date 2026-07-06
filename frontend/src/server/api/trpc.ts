import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getOrCreateStellarWallet,
  privyConfigured,
  rawSign,
  verifyUser
} from "../../lib/privy-server";

type Context = {
  token: string | null;
};

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function createTRPCContext(req: Request): Context {
  return { token: bearer(req) };
}

const t = initTRPC.context<Context>().create();

const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!privyConfigured) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Privy not configured" });
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

const hashHexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "hashHex must be a 32-byte hex string");

export const appRouter = t.router({
  privy: t.router({
    wallet: authedProcedure.mutation(async ({ ctx }) => {
      return getOrCreateStellarWallet(ctx.userId);
    }),
    sign: authedProcedure
      .input(
        z.object({
          walletId: z.string().min(1),
          hashHex: hashHexSchema
        })
      )
      .mutation(async ({ input }) => {
        const signatureHex = await rawSign(input.walletId, input.hashHex);
        return { signatureHex };
      })
  })
});

export type AppRouter = typeof appRouter;
