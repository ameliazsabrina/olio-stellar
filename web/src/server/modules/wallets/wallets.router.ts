import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  WalletConflictError,
  WalletDeploymentError,
  WalletEscrowAlreadyInitializedError,
  WalletEscrowClobberError,
  WalletEscrowMissingError,
  WalletEscrowRevisionConflictError,
  WalletMigrationError,
} from "./wallets.errors";
import {
  escrowOutput,
  optionalWalletOutput,
  privyWalletInput,
  rotateEscrowInput,
  rotateEscrowOutput,
  saveEscrowInput,
  walletOutput,
} from "./wallets.schema";
import {
  bootstrapWallet,
  currentWallet,
  getEscrow,
  restoreWallet,
  rotateEscrow,
  saveEscrow,
} from "./wallets.service";

function mapError(error: unknown): never {
  if (
    error instanceof WalletConflictError ||
    error instanceof WalletEscrowClobberError ||
    error instanceof WalletEscrowAlreadyInitializedError ||
    error instanceof WalletEscrowRevisionConflictError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof WalletEscrowMissingError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
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
  restore: protectedProcedure
    .output(optionalWalletOutput)
    .mutation(({ ctx }) => restoreWallet(ctx.privyUserId).catch(mapError)),
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
  rotateEscrow: protectedProcedure
    .input(rotateEscrowInput)
    .output(rotateEscrowOutput)
    .mutation(({ ctx, input }) =>
      rotateEscrow(ctx.privyUserId, input).catch(mapError),
    ),
});
