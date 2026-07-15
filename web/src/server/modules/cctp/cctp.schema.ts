import { z } from "zod";

const hex = z.string().regex(/^0x?[0-9a-fA-F]*$/, "expected hex");
const bytes32Hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex");

// Iris is queried by an EVM 32-byte hash or a Solana base58 signature (43–88 chars).
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{43,88}$/;

export const isCctpTxHash = (v: string): boolean =>
  EVM_TX_HASH.test(v) || SOLANA_SIGNATURE.test(v);

const cctpTxHash = z
  .string()
  .refine(isCctpTxHash, "expected an EVM tx hash or a Solana signature");

export const attestationInput = z
  .object({
    sourceDomain: z.number().int().min(0),
    txHash: cctpTxHash,
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
    // Payer salt recombined with the payee note key to bind the burn's hookData commitment.
    nonce: bytes32Hex,
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
