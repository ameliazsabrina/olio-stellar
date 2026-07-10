import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  ChannelsNoHashError,
  ChannelsNotConfiguredError,
  ChannelsRelayRejectedError,
  ChannelsRelayUnreachableError,
} from "../channels/channels.errors";
import {
  deployInput,
  relayInput,
  relayResultOutput,
  saveWalletInput,
  walletByCredentialInput,
  walletOutput,
} from "./passkey.schema";
import {
  deployWallet,
  relaySoroban,
  saveWallet,
  walletByCredential,
} from "./passkey.service";

function mapError(e: unknown): never {
  if (e instanceof ChannelsNotConfiguredError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
  }
  if (e instanceof ChannelsRelayRejectedError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  }
  if (e instanceof ChannelsRelayUnreachableError) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
  }
  if (e instanceof ChannelsNoHashError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  throw e;
}

// Passkey smart-wallet onboarding. All public: the deploy and the first writes
// happen before any session exists, and the smart wallet's on-chain __check_auth
// is what guards funds. Only the relayer fee budget is exposed.
// TODO(WS4): gate the relay procedures behind a passkey session + rate limit.
export const passkeyRouter = createTRPCRouter({
  deploy: publicProcedure
    .input(deployInput)
    .output(relayResultOutput)
    .mutation(({ input }) => deployWallet(input.xdr).catch(mapError)),

  relaySoroban: publicProcedure
    .input(relayInput)
    .output(relayResultOutput)
    .mutation(({ input }) =>
      relaySoroban(input.func, input.auth).catch(mapError),
    ),

  saveWallet: publicProcedure
    .input(saveWalletInput)
    .mutation(async ({ input }) => {
      await saveWallet(input);
      return { ok: true };
    }),

  walletByCredential: publicProcedure
    .input(walletByCredentialInput)
    .output(walletOutput)
    .query(({ input }) => walletByCredential(input.credentialId)),
});
