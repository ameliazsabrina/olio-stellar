import { TRPCError } from "@trpc/server";
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
    .query(({ input }) =>
      fetchAttestation(input.sourceDomain, input.txHash).catch(mapError),
    ),

  relay: publicProcedure
    .input(relayInput)
    .output(relayOutput)
    .mutation(({ input }) => relayDeposit(input).catch(mapError)),
});
