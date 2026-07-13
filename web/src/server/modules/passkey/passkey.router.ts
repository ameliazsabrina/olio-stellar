import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  ChannelsNoHashError,
  ChannelsNotConfiguredError,
  ChannelsRelayRejectedError,
  ChannelsRelayUnreachableError,
} from "../channels/channels.errors";
import { EscrowClobberError } from "./passkey.errors";
import {
  deployInput,
  escrowOutput,
  getEscrowInput,
  relayInput,
  relayResultOutput,
  saveEscrowInput,
  saveWalletInput,
  walletByCredentialInput,
  walletOutput,
} from "./passkey.schema";
import {
  deployWallet,
  getEscrow,
  relaySoroban,
  saveEscrow,
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
  if (e instanceof EscrowClobberError) {
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  }
  throw e;
}

// getEscrow is public (no session infra yet — WS4), so throttle it: a leaked
// blob is only as safe as its Argon2id cost, and rate-limiting caps how fast an
// attacker can harvest blobs or hammer a single credential. Keyed on both the
// credential and the origin IP; either tripping blocks the call.
const ESCROW_LIMIT = 10;
const ESCROW_WINDOW_MS = 60_000;

function enforceEscrowRateLimit(credentialId: string, ip: string | null): void {
  const keys = [`escrow:cred:${credentialId}`];
  if (ip) keys.push(`escrow:ip:${ip}`);
  for (const key of keys) {
    const { ok, retryAfterMs } = rateLimit(key, ESCROW_LIMIT, ESCROW_WINDOW_MS);
    if (!ok) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many attempts. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
      });
    }
  }
}

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

  saveEscrow: publicProcedure
    .input(saveEscrowInput)
    .mutation(async ({ input }) => {
      await saveEscrow(input).catch(mapError);
      return { ok: true };
    }),

  getEscrow: publicProcedure
    .input(getEscrowInput)
    .output(escrowOutput)
    .query(({ input, ctx }) => {
      enforceEscrowRateLimit(input.credentialId, ctx.ip);
      return getEscrow(input.credentialId).catch(mapError);
    }),
});
