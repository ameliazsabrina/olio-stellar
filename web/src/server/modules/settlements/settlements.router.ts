import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { mapInvoiceError } from "../invoices/invoices.router";
import {
  SettlementNotFoundError,
  SettlementStateError,
} from "./settlements.errors";
import {
  claimHistoricalInput,
  listSettlementsInput,
  recordRefundInput,
  settlementListOutput,
  settlementOutput,
  settlementsByLeavesInput,
} from "./settlements.schema";
import {
  claimHistorical,
  listSettlements,
  recordRefund,
  settlementsByLeaves,
} from "./settlements.service";

export function mapSettlementError(error: unknown): never {
  if (error instanceof SettlementNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof SettlementStateError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  return mapInvoiceError(error);
}

export const settlementsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(listSettlementsInput)
    .output(settlementListOutput)
    .query(({ ctx, input }) =>
      listSettlements(ctx.privyUserId, input).catch(mapSettlementError),
    ),
  byLeaves: protectedProcedure
    .input(settlementsByLeavesInput)
    .output(settlementOutput.array())
    .query(({ ctx, input }) =>
      settlementsByLeaves(ctx.privyUserId, input).catch(mapSettlementError),
    ),
  recordRefund: protectedProcedure
    .input(recordRefundInput)
    .output(settlementOutput)
    .mutation(({ ctx, input }) =>
      recordRefund(ctx.privyUserId, input).catch(mapSettlementError),
    ),
  claimHistorical: protectedProcedure
    .input(claimHistoricalInput)
    .output(settlementOutput)
    .mutation(({ ctx, input }) =>
      claimHistorical(ctx.privyUserId, input).catch(mapSettlementError),
    ),
});
