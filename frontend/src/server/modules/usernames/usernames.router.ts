import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { byOwnerInput, registerInput, resolveInput } from "./usernames.schema";
import { RegistryLookupFailedError, UsernameNotOnChainError } from "./usernames.errors";
import { registerUsernameCache, resolveUsername, usernameByOwner } from "./usernames.service";

function mapError(e: unknown): never {
  if (e instanceof RegistryLookupFailedError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  if (e instanceof UsernameNotOnChainError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
  }
  throw e;
}

export const usernamesRouter = createTRPCRouter({
  resolve: publicProcedure
    .input(resolveInput)
    .query(({ input }) => resolveUsername(input.username).catch(mapError)),

  register: publicProcedure
    .input(registerInput)
    .mutation(({ input }) => registerUsernameCache(input.username).catch(mapError)),

  byOwner: publicProcedure.input(byOwnerInput).query(({ input }) => usernameByOwner(input.owner))
});
