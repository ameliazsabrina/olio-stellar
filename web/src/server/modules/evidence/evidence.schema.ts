import { z } from "zod";

export const evidenceKeyOutput = z.object({
  keyId: z.string(),
  publicKey: z.string(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});

export const evidenceManifestOutput = z
  .object({
    network: z.string(),
    poolId: z.string(),
    epoch: z.number().int(),
    manifestHash: z.string(),
    anchorState: z.enum(["pending", "submitted", "confirmed"]),
    anchorTxHash: z.string().nullable(),
    issuedAt: z.string(),
  })
  .nullable();

export const evidenceStatusOutput = z.object({
  mode: z.enum(["off", "testnet", "mainnet"]),
  issuanceOpen: z.boolean(),
  keys: evidenceKeyOutput.array(),
});

export type EvidenceKeyOutput = z.infer<typeof evidenceKeyOutput>;
export type EvidenceManifestOutput = z.infer<typeof evidenceManifestOutput>;
export type EvidenceStatusOutput = z.infer<typeof evidenceStatusOutput>;
