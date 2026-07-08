import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { listDepositsInput } from "./deposits.schema";
import { DepositIndexGapError } from "./deposits.errors";
import { listDeposits } from "./deposits.service";

function mapError(e: unknown): never {
  if (e instanceof DepositIndexGapError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  throw e;
}

// Public (no auth) — off-chain mirror of on-chain/encrypted data, not user secrets.
export const depositsRouter = createTRPCRouter({
  list: publicProcedure
    .input(listDepositsInput)
    .query(({ input }) => listDeposits(input?.since ?? -1).catch(mapError))
});
