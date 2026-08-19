import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  ChannelsNoHashError,
  ChannelsNotConfiguredError,
  ChannelsRelayRejectedError,
  ChannelsRelayUnreachableError,
} from "./channels.errors";
import { relayInput, relayResultOutput } from "./channels.schema";
import { relaySoroban } from "./channels.service";

function mapError(error: unknown): never {
  if (error instanceof ChannelsNotConfiguredError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof ChannelsRelayRejectedError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof ChannelsRelayUnreachableError) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
  }
  if (error instanceof ChannelsNoHashError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  throw error;
}

export const channelsRouter = createTRPCRouter({
  relaySoroban: publicProcedure
    .input(relayInput)
    .output(relayResultOutput)
    .mutation(({ input }) =>
      relaySoroban(input.func, input.auth).catch(mapError),
    ),
});
