import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  CctpAttestationError,
  CctpConfigError,
  CctpPayeeError,
  CctpRelayError,
} from "./cctp.errors";
import {
  attestationInput,
  attestationOutput,
  relayInput,
  relayOutput,
} from "./cctp.schema";
import { fetchAttestation, relayDeposit } from "./cctp.service";

// Public unauthenticated procedures driving scarce resources; throttle per IP.
const ATTEST_LIMIT = 60;
const RELAY_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function enforceRateLimit(
  kind: string,
  limit: number,
  ip: string | null,
): void {
  if (!ip) return;
  const { ok, retryAfterMs } = rateLimit(
    `cctp:${kind}:ip:${ip}`,
    limit,
    RATE_WINDOW_MS,
  );
  if (!ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
    });
  }
}

function mapError(e: unknown): never {
  if (e instanceof CctpPayeeError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  if (e instanceof CctpConfigError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  if (e instanceof CctpAttestationError || e instanceof CctpRelayError) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
  }
  throw e;
}

export const cctpRouter = createTRPCRouter({
  attestation: publicProcedure
    .input(attestationInput)
    .output(attestationOutput)
    .query(({ input, ctx }) => {
      enforceRateLimit("attest", ATTEST_LIMIT, ctx.ip);
      return fetchAttestation(input.sourceDomain, input.txHash).catch(mapError);
    }),

  relay: publicProcedure
    .input(relayInput)
    .output(relayOutput)
    .mutation(({ input, ctx }) => {
      enforceRateLimit("relay", RELAY_LIMIT, ctx.ip);
      return relayDeposit(input).catch(mapError);
    }),
});
