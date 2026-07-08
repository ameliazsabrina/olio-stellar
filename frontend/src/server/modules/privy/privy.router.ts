import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { signInput } from "./privy.schema";
import { getOrCreateStellarWallet, rawSign } from "./privy.service";

export const privyRouter = createTRPCRouter({
  wallet: protectedProcedure.mutation(({ ctx }) => getOrCreateStellarWallet(ctx.userId)),

  sign: protectedProcedure.input(signInput).mutation(async ({ input }) => {
    const signatureHex = await rawSign(input.walletId, input.hashHex);
    return { signatureHex };
  })
});
