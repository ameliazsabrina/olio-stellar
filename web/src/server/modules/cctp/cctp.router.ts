import { TRPCError } from "@trpc/server";
import { PAYER_MESSAGES, toPayerError, tooManyAttempts } from "../../lib/payerErrors";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  CctpOperationalError,
  CctpAttestationError,
  CctpConfigError,
  CctpPayeeError,
  CctpRelayError,
} from "./cctp.errors";
import {
  sessionAuth, createSessionInput, recordSubmissionInput, sessionStatusOutput,
  attestationInput,
  attestationOutput,
  relayInput,
  relayOutput,
} from "./cctp.schema";
import { fetchAttestation, relayDeposit } from "./cctp.service";

import { z } from "zod";
import { routeReadiness, assertRouteReady } from "./cctp.readiness";
import { createSession, recordSubmission, authorizedSession, publicSession, resumeSession } from "./cctp.sessions";
import { sharedBudget, digest } from "./cctp.storage";
import { assertPaymentIngressReady } from "../feeQuotes/feeQuotes.readiness";

// Public unauthenticated procedures driving scarce resources; throttle per IP.
const ATTEST_LIMIT = 60;
const RELAY_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function enforceRateLimit(
  kind: string,
  limit: number,
  ip: string | null,
): void {
  const { ok, retryAfterMs } = rateLimit(
    `cctp:${kind}:ip:${ip ?? "unknown"}`,
    limit,
    RATE_WINDOW_MS,
  );
  if (!ok) throw tooManyAttempts(retryAfterMs);
}

// Only /pay calls this router; internal messages travel as the cause for logs.
// Pre-send failures reach the payer as-is; post-send ones are replaced client-side.
const NETWORK_UNAVAILABLE =
  "Payments from this network are temporarily unavailable. You haven't been charged.";

function mapError(e: unknown): never {
  if (e instanceof CctpOperationalError) {
    if (e.code === "unauthorized")
      throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find this payment. Check your payment backup.", cause: e });
    if (e.code === "throttled") throw tooManyAttempts(e.retryAfterMs);
    if (e.code === "binding")
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This payment can't continue. Please start a new payment.", cause: e });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: NETWORK_UNAVAILABLE, cause: e });
  }
  if (e instanceof CctpPayeeError) {
    throw new TRPCError({ code: "NOT_FOUND", message: PAYER_MESSAGES.recipientNotFound, cause: e });
  }
  if (e instanceof CctpConfigError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Paying from other networks isn't available right now.", cause: e });
  }
  if (e instanceof CctpAttestationError || e instanceof CctpRelayError) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: NETWORK_UNAVAILABLE, cause: e });
  }
  throw toPayerError(e);
}

export const cctpRouter = createTRPCRouter({
  readiness: publicProcedure.input(z.object({ sourceDomain: z.number().int() }).strict()).query(async ({ input, ctx }) => {
    enforceRateLimit("readiness", 30, ctx.ip);
    return routeReadiness(input.sourceDomain);
  }),
  createSession: publicProcedure.input(createSessionInput).output(sessionStatusOutput).mutation(async ({ input, ctx }) => {
    try {
      enforceRateLimit("create", 5, ctx.ip);
      await sharedBudget(`session-ip:${digest(ctx.ip ?? "unknown")}`, 10, 60_000);
      return await createSession(input);
    } catch (error) { return mapError(error); }
  }),
  // Capability-bearing operations are POST mutations; credentials never enter query URLs.
  sessionStatus: publicProcedure.input(sessionAuth).output(sessionStatusOutput).mutation(async ({ input, ctx }) => {
    enforceRateLimit("status", 60, ctx.ip);
    try { return publicSession(await authorizedSession(input)); } catch (error) { return mapError(error); }
  }),
  recordSubmission: publicProcedure.input(recordSubmissionInput).output(sessionStatusOutput).mutation(async ({ input, ctx }) => {
    enforceRateLimit("submission", 30, ctx.ip);
    try { return await recordSubmission(input); } catch (error) { return mapError(error); }
  }),
  resumeSession: publicProcedure.input(sessionAuth).output(sessionStatusOutput).mutation(async ({ input, ctx }) => {
    enforceRateLimit("resume", 10, ctx.ip);
    try { return await resumeSession(input); } catch (error) { return mapError(error); }
  }),
  prepareBurn: publicProcedure.input(sessionAuth).output(sessionStatusOutput).mutation(async ({ input, ctx }) => {
    enforceRateLimit("prepare", 10, ctx.ip);
    try {
      const session = await authorizedSession(input);
      if (session.stage !== "awaiting_signature") throw new CctpOperationalError("binding");
      await assertPaymentIngressReady("cctp");
      await assertRouteReady(session.sourceDomain);
      return await recordSubmission(input);
    } catch (error) { return mapError(error); }
  }),
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
