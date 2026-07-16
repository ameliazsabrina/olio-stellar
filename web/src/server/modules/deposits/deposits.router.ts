import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { DepositIndexGapError } from "./deposits.errors";
import {
  depositOutput,
  listDepositsInput,
  poolSnapshotInput,
  poolSnapshotOutput,
} from "./deposits.schema";
import { getPoolSnapshot, listDeposits } from "./deposits.service";

function mapError(e: unknown): never {
  if (e instanceof DepositIndexGapError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  throw e;
}

export const depositsRouter = createTRPCRouter({
  snapshot: publicProcedure
    .input(poolSnapshotInput)
    .output(poolSnapshotOutput)
    .query(({ input }) =>
      getPoolSnapshot(
        input?.afterLeafIndex ?? -1,
        input?.spentAfterLedger ?? 0,
      ).catch(mapError),
    ),
  list: publicProcedure
    .input(listDepositsInput)
    .output(depositOutput.array())
    .query(({ input }) => listDeposits(input?.since ?? -1).catch(mapError)),
});
