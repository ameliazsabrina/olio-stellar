import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  WalletConflictError,
  WalletDeploymentError,
  WalletEscrowClobberError,
  WalletMigrationError,
} from "./wallets.errors";
import {
  escrowOutput,
  optionalWalletOutput,
  privyWalletInput,
  saveEscrowInput,
  walletOutput,
} from "./wallets.schema";
import {
  bootstrapWallet,
  currentWallet,
  getEscrow,
  saveEscrow,
} from "./wallets.service";

function mapError(error: unknown): never {
  if (
    error instanceof WalletConflictError ||
    error instanceof WalletEscrowClobberError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof WalletDeploymentError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof WalletMigrationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

export const walletsRouter = createTRPCRouter({
  current: protectedProcedure
    .output(optionalWalletOutput)
    .query(({ ctx }) => currentWallet(ctx.privyUserId).catch(mapError)),
  bootstrap: protectedProcedure
    .input(privyWalletInput)
    .output(walletOutput)
    .mutation(({ ctx, input }) =>
      bootstrapWallet(ctx.privyUserId, input).catch(mapError),
    ),
  saveEscrow: protectedProcedure
    .input(saveEscrowInput)
    .mutation(async ({ ctx, input }) => {
      await saveEscrow(ctx.privyUserId, input).catch(mapError);
      return { ok: true };
    }),
  getEscrow: protectedProcedure
    .output(escrowOutput)
    .query(({ ctx }) => getEscrow(ctx.privyUserId).catch(mapError)),
});
