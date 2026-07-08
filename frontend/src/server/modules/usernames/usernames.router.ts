import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { byOwnerInput, resolveInput } from "./usernames.schema";
import { RegistryLookupFailedError } from "./usernames.errors";
import { resolveUsername, usernameByOwner } from "./usernames.service";

function mapError(e: unknown): never {
  if (e instanceof RegistryLookupFailedError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  throw e;
}

export const usernamesRouter = createTRPCRouter({
  resolve: publicProcedure
    .input(resolveInput)
    .query(({ input }) => resolveUsername(input.username).catch(mapError)),

  byOwner: publicProcedure.input(byOwnerInput).query(({ input }) => usernameByOwner(input.owner))
});
