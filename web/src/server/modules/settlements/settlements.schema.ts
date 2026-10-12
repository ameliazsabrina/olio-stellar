import { z } from "zod";
import { businessIdSchema } from "../businesses/businesses.schema";

const I64_MAX = (1n << 63n) - 1n;
const settlementIdSchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9:_-]+$/);
const txHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected a transaction hash");
const leafIndex = z.number().int().min(0).max(0xffff_ffff);

export const recordRefundInput = z
  .object({
    settlementId: settlementIdSchema,
    withdrawTxHash: txHash,
  })
  .strict();

export const claimHistoricalInput = z
  .object({
    businessId: businessIdSchema,
    leafIndex,
    amount: z
      .string()
      .regex(/^\d{1,19}$/)
      .refine((v) => BigInt(v) > 0n && BigInt(v) <= I64_MAX),
    salt: z.string().regex(/^[0-9a-f]{64}$/, "expected 32-byte hex"),
  })
  .strict();

export const listSettlementsInput = z
  .object({
    businessId: businessIdSchema,
    beforeLeafIndex: leafIndex.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const settlementsByLeavesInput = z
  .object({
    businessId: businessIdSchema,
    leafIndexes: leafIndex.array().max(500),
  })
  .strict();

export const settlementOutput = z.object({
  settlementId: z.string(),
  leafIndex: z.number().int(),
  txHash: z.string(),
  eventId: z.string().nullable(),
  ledger: z.number().int(),
  ledgerClosedAt: z.string(),
  amount: z.string().nullable(),
  allocatedAmount: z.string(),
  refundedAmount: z.string(),
  payer: z.string().nullable(),
  rail: z.enum(["direct", "cctp", "fiat"]),
  railRefs: z.object({
    sourceDomain: z.number().int().nullable(),
    sourceTxHash: z.string().nullable(),
    payerSentAt: z.string().nullable(),
    mintTxHash: z.string().nullable(),
  }),
  evidenceLevel: z.enum([
    "intent_bound",
    "attributed",
    "historical_claim",
    "unattributed",
  ]),
  qualification: z.object({
    counted: z.boolean(),
    selfFunded: z.boolean(),
    policyVersion: z.number().int(),
  }),
  invoices: z
    .object({ invoiceId: z.string(), number: z.number().int() })
    .array(),
});

export const settlementListOutput = z.object({
  items: settlementOutput.array(),
  nextBeforeLeafIndex: z.number().int().nullable(),
});

export type RecordRefundInput = z.infer<typeof recordRefundInput>;
export type ClaimHistoricalInput = z.infer<typeof claimHistoricalInput>;
export type ListSettlementsInput = z.infer<typeof listSettlementsInput>;
export type SettlementsByLeavesInput = z.infer<typeof settlementsByLeavesInput>;
export type SettlementOutput = z.infer<typeof settlementOutput>;
export type SettlementListOutput = z.infer<typeof settlementListOutput>;
