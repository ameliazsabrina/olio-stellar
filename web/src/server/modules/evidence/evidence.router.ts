import { TRPCError } from "@trpc/server";
import type { EvidenceKeyDoc } from "../../db/mongo";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { evidenceConfig } from "./evidence.config";
import { issuanceGate } from "./evidence.gate";
import {
  type EvidenceKeyOutput,
  evidenceManifestOutput,
  evidenceStatusOutput,
} from "./evidence.schema";
import { latestEpoch, publishedEvidenceKeys } from "./evidence.service";

function enforcePublicRateLimit(ip: string | null): void {
  const { ok, retryAfterMs } = rateLimit(
    `evidence:public:${ip ?? "unknown"}`,
    120,
    60_000,
  );
  if (!ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
    });
  }
}

export function toKeyOutput(doc: EvidenceKeyDoc): EvidenceKeyOutput {
  return {
    keyId: doc._id,
    publicKey: doc.publicKey,
    validFrom: doc.validFrom.toISOString(),
    validTo: doc.validTo?.toISOString() ?? null,
  };
}

export const evidenceRouter = createTRPCRouter({
  status: publicProcedure
    .output(evidenceStatusOutput)
    .query(async ({ ctx }) => {
      enforcePublicRateLimit(ctx.ip);
      const config = evidenceConfig();
      const [gate, keys] = await Promise.all([
        issuanceGate(config),
        publishedEvidenceKeys(),
      ]);
      return {
        mode: config.mode,
        issuanceOpen: gate.open,
        keys: keys.map(toKeyOutput),
      };
    }),
  manifest: publicProcedure
    .output(evidenceManifestOutput)
    .query(async ({ ctx }) => {
      enforcePublicRateLimit(ctx.ip);
      const epoch = await latestEpoch();
      return epoch
        ? {
            network: epoch.network,
            poolId: epoch.poolId,
            epoch: epoch.epoch,
            manifestHash: epoch.manifestHash,
            anchorState: epoch.anchorState,
            anchorTxHash: epoch.anchorTxHash,
            issuedAt: epoch.issuedAt.toISOString(),
          }
        : null;
    }),
});
