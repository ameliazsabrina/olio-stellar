import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { DepositIndexGapError } from "./deposits.errors";
import { depositOutput, listDepositsInput } from "./deposits.schema";
import { listDeposits } from "./deposits.service";

function mapError(e: unknown): never {
  if (e instanceof DepositIndexGapError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  throw e;
}

export const depositsRouter = createTRPCRouter({
  list: publicProcedure
    .input(listDepositsInput)
    .output(depositOutput.array())
    .query(({ input }) => listDeposits(input?.since ?? -1).catch(mapError)),
});
