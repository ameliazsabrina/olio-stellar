import { z } from "zod";
import { issueOutput as feeQuoteEnvelope } from "../feeQuotes/feeQuotes.schema";

const boundedHex = (maxBytes: number) =>
  z
    .string()
    .min(2)
    .max(maxBytes * 2 + 2)
    .refine((value) => {
      const raw = value.startsWith("0x") ? value.slice(2) : value;
      return (
        raw.length > 0 &&
        raw.length <= maxBytes * 2 &&
        raw.length % 2 === 0 &&
        /^[0-9a-fA-F]+$/.test(raw)
      );
    }, "expected even-length bounded hex");
const bytes32Hex = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "expected 32-byte hex");

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
    sourceDomain: z.number().int().min(0).max(0xffff_ffff),
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
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_-]{3,32}$/),
    sourceTxHash: cctpTxHash,
    message: boundedHex(4_096),
    attestation: boundedHex(4_096),
    salt: bytes32Hex,
    feeQuote: feeQuoteEnvelope,
  })
  .strict();

export const relayOutput = z
  .object({
    leafIndex: z.number().int(),
    paymentAmount: z.string(),
    feeAmount: z.string(),
    totalAmount: z.string(),
    feePolicyVersion: z.number().int(),
    txHash: z.string(),
  })
  .strict();

export type AttestationInput = z.infer<typeof attestationInput>;
export type AttestationOutput = z.infer<typeof attestationOutput>;
export type RelayInput = z.infer<typeof relayInput>;
export type RelayOutput = z.infer<typeof relayOutput>;

export const sessionAuth = z.object({ sessionId: z.string().regex(/^[a-f0-9]{64}$/), capability: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const createSessionInput = relayInput.pick({ username: true, salt: true, feeQuote: true }).extend({
  // Created and saved by the browser before this request, so losing the response is recoverable.
  capability: z.string().regex(/^[a-f0-9]{64}$/),
  legacySourceTxHash: cctpTxHash.optional(),
}).strict();
export const recordSubmissionInput = sessionAuth.extend({
  sourceTxHash: cctpTxHash.optional(),
  solanaBlockhash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional(),
  solanaLastValidBlockHeight: z.number().int().nonnegative().optional(),
}).strict();
export const sessionStatusOutput = z.object({
  sessionId: z.string(), sourceDomain: z.number().int(), stage: z.enum(["awaiting_signature", "submission_unknown", "source_submitted", "confirming_source", "awaiting_attestation", "minting", "minted", "depositing", "completed", "needs_attention"]),
  paymentAmount: z.string(), feeAmount: z.string(), totalAmount: z.string(),
  sourceTxHash: z.string().nullable(), destinationTxHash: z.string().nullable(),
  errorCode: z.string().nullable(), retryAfterMs: z.number(), updatedAt: z.string(),
  result: relayOutput.nullable(),
}).strict();
export type SessionAuth = z.infer<typeof sessionAuth>;
export type CreateSessionInput = z.infer<typeof createSessionInput>;
export type RecordSubmissionInput = z.infer<typeof recordSubmissionInput>;
export type SessionStatus = z.infer<typeof sessionStatusOutput>;
