import { z } from "zod";

const hex = z.string().regex(/^0x?[0-9a-fA-F]*$/, "expected hex");

export const attestationInput = z
  .object({
    sourceDomain: z.number().int().min(0),
    txHash: z.string().min(3),
  })
  .strict();

export const attestationOutput = z
  .object({
    status: z.enum(["pending", "complete"]),
    message: z.string().nullable(),
    attestation: z.string().nullable(),
  })
  .strict();

export const relayInput = z
  .object({
    username: z.string().min(1),
    message: hex,
    attestation: hex,
  })
  .strict();

export const relayOutput = z
  .object({
    leafIndex: z.number().int(),
    amount: z.string(),
    txHash: z.string(),
  })
  .strict();

export type AttestationInput = z.infer<typeof attestationInput>;
export type AttestationOutput = z.infer<typeof attestationOutput>;
export type RelayInput = z.infer<typeof relayInput>;
export type RelayOutput = z.infer<typeof relayOutput>;
