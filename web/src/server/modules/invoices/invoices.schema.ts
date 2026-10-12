import { z } from "zod";
import { businessIdSchema } from "../businesses/businesses.schema";

const I64_MAX = (1n << 63n) - 1n;
const ENCRYPTED_CONTENT_MAX_HEX = (24 + 16_384 + 16) * 2;
const ENCRYPTED_CONTENT_MIN_HEX = (24 + 16 + 2) * 2;
const WRAPPED_KEY_HEX = (32 + 24 + 32 + 16) * 2;

export const invoiceIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const invoiceStateSchema = z.enum([
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
  "void",
]);

const lowerHex = z.string().regex(/^[0-9a-f]*$/, "expected lowercase hex");

export const baseUnitAmount = z
  .string()
  .regex(/^\d{1,19}$/, "expected base-unit integer")
  .refine((value) => {
    const amount = BigInt(value);
    return amount > 0n && amount <= I64_MAX;
  }, "amount is out of range");

const encryptedContent = lowerHex
  .min(ENCRYPTED_CONTENT_MIN_HEX)
  .max(ENCRYPTED_CONTENT_MAX_HEX)
  .refine((value) => value.length % 2 === 0, "expected whole bytes");
const wrappedKey = lowerHex.length(WRAPPED_KEY_HEX);
const commitmentHex = lowerHex.length(64);
const dueAt = z.iso.datetime().nullable();

const versionPayload = {
  amountDue: baseUnitAmount,
  dueAt,
  encryptedContent,
  wrappedKey,
  contentCommitment: commitmentHex,
};

export const createInvoiceInput = z
  .object({
    businessId: businessIdSchema,
    ...versionPayload,
    issue: z.boolean().default(true),
  })
  .strict();

export const reviseInvoiceInput = z
  .object({
    invoiceId: invoiceIdSchema,
    expectedVersion: z.number().int().min(1),
    ...versionPayload,
  })
  .strict();

export const issueInvoiceInput = z
  .object({
    invoiceId: invoiceIdSchema,
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export const invoiceIdInput = z.object({ invoiceId: invoiceIdSchema }).strict();

export const listInvoicesInput = z
  .object({
    businessId: businessIdSchema,
    state: invoiceStateSchema.optional(),
    beforeNumber: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const invoiceVersionOutput = z.object({
  version: z.number().int(),
  network: z.string(),
  poolId: z.string(),
  asset: z.string(),
  amountDue: z.string(),
  issuedAt: z.string(),
  dueAt: z.string().nullable(),
  encryptedContent: z.string().nullable(),
  wrappedKey: z.string().nullable(),
  contentCommitment: z.string(),
  invoiceCommitment: z.string(),
  createdAt: z.string(),
});

export const invoiceSummaryOutput = z.object({
  invoiceId: z.string(),
  businessId: z.string(),
  number: z.number().int(),
  state: invoiceStateSchema,
  currentVersion: z.number().int(),
  amountDue: z.string(),
  allocatedAmount: z.string(),
  refundedAmount: z.string(),
  paidAmount: z.string(),
  remainingAmount: z.string(),
  issuedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  erased: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  current: invoiceVersionOutput,
});

export const invoiceListOutput = z.object({
  items: invoiceSummaryOutput.array(),
  nextBeforeNumber: z.number().int().nullable(),
});

export const invoiceAllocationOutput = z.object({
  allocationId: z.string(),
  settlementId: z.string(),
  invoiceVersion: z.number().int(),
  amount: z.string(),
  refundedAmount: z.string(),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
  txHash: z.string().nullable(),
  ledgerClosedAt: z.string().nullable(),
  rail: z.enum(["direct", "cctp", "fiat"]).nullable(),
});

export const invoiceEventOutput = z.object({
  kind: z.enum([
    "created",
    "issued",
    "revised",
    "cancelled",
    "allocation",
    "refund",
    "erased",
  ]),
  version: z.number().int().nullable(),
  amount: z.string().nullable(),
  settlementId: z.string().nullable(),
  at: z.string(),
});

export const invoiceIntentOutput = z.object({
  intentId: z.string(),
  invoiceVersion: z.number().int(),
  channel: z.enum(["direct", "cctp"]),
  state: z.enum(["open", "settled", "expired"]),
  amount: z.string(),
  payerSentAt: z.string().nullable(),
  settledAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const invoiceDetailOutput = invoiceSummaryOutput.extend({
  versions: invoiceVersionOutput.array(),
  allocations: invoiceAllocationOutput.array(),
  events: invoiceEventOutput.array(),
  intents: invoiceIntentOutput.array(),
});

export const publicInvoiceOutput = z
  .object({
    invoiceId: z.string(),
    number: z.number().int(),
    version: z.number().int(),
    state: invoiceStateSchema,
    payable: z.boolean(),
    amountDue: z.string(),
    remainingAmount: z.string(),
    network: z.string(),
    asset: z.string(),
    issuedAt: z.string(),
    dueAt: z.string().nullable(),
    encryptedContent: z.string().nullable(),
    contentCommitment: z.string(),
    invoiceCommitment: z.string(),
    business: z.object({
      displayName: z.string().nullable(),
      verifiedPublicId: z.string().nullable(),
    }),
  })
  .nullable();

export type CreateInvoiceInput = z.infer<typeof createInvoiceInput>;
export type ReviseInvoiceInput = z.infer<typeof reviseInvoiceInput>;
export type IssueInvoiceInput = z.infer<typeof issueInvoiceInput>;
export type ListInvoicesInput = z.infer<typeof listInvoicesInput>;
export type InvoiceVersionOutput = z.infer<typeof invoiceVersionOutput>;
export type InvoiceSummaryOutput = z.infer<typeof invoiceSummaryOutput>;
export type InvoiceListOutput = z.infer<typeof invoiceListOutput>;
export type InvoiceDetailOutput = z.infer<typeof invoiceDetailOutput>;
export type PublicInvoiceOutput = z.infer<typeof publicInvoiceOutput>;
