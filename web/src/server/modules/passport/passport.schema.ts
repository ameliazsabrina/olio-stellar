import { z } from "zod";
import {
  businessIdSchema,
  businessTypeSchema,
} from "../businesses/businesses.schema";
import { credentialSummary } from "../verification/verification.schema";

export const identityPreviewOutput = z.object({
  businessId: z.string(),
  publicId: z.string(),
  displayName: z.string().nullable(),
  type: businessTypeSchema,
  credential: credentialSummary.nullable(),
});

export const statementDetailSchema = z.enum(["summary", "full"]);
export const statementPeriodSchema = z.enum(["3m", "6m", "12m", "all"]);
export const payerMaskSchema = z.enum(["masked", "full", "hidden"]);
export const statementIdSchema = z
  .string()
  .regex(/^pst_[A-Za-z0-9_-]{22}$/, "Invalid statement id.");

const baseUnits = z.string().regex(/^\d+$/);
const isoDate = z.string();

export const issueStatementInput = z
  .object({
    businessId: businessIdSchema,
    detail: statementDetailSchema,
    period: statementPeriodSchema,
    payerMask: payerMaskSchema,
  })
  .strict();

export const revokeStatementInput = z
  .object({ businessId: businessIdSchema, statementId: statementIdSchema })
  .strict();

export const verifyStatementInput = z
  .object({ statementId: statementIdSchema })
  .strict();

const statementPeriod = z.object({
  preset: statementPeriodSchema,
  from: isoDate,
  to: isoDate,
});

const statementSummary = z.object({
  totalReceived: baseUnits,
  paymentCount: z.number().int(),
  distinctPayers: z.number().int(),
  excludedCount: z.number().int(),
});

export const statementMonth = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int(),
  amount: baseUnits,
});

export const statementRow = z.object({
  date: isoDate,
  amount: baseUnits,
  refunded: baseUnits,
  rail: z.enum(["direct", "cctp", "fiat"]),
  invoices: z.array(z.number().int()),
  txHash: z.string(),
  evidenceLevel: z.enum([
    "intent_bound",
    "attributed",
    "historical_claim",
    "unattributed",
  ]),
  payer: z.string().nullable(),
});

export const passportStatement = z.object({
  kind: z.literal("olio.passport.statement"),
  version: z.literal(1),
  statementId: z.string(),
  issuer: z.literal("olio"),
  network: z.string(),
  poolId: z.string(),
  business: z.object({
    displayName: z.string().nullable(),
    type: businessTypeSchema,
    verified: z.literal(true),
    checkedAt: isoDate,
    validUntil: isoDate,
  }),
  period: statementPeriod,
  detail: statementDetailSchema,
  payerMask: payerMaskSchema.nullable(),
  summary: statementSummary,
  months: z.array(statementMonth),
  rows: z.array(statementRow).nullable(),
  qualificationPolicyVersion: z.number().int(),
  recordsAsOf: isoDate,
  issuedAt: isoDate,
  expiresAt: isoDate,
});

export const statementOutput = z.object({
  statement: passportStatement,
  digest: z.string(),
  verifyPath: z.string(),
});

export const statementStatusSchema = z.enum(["valid", "revoked", "expired"]);

export const statementListItem = z.object({
  statementId: z.string(),
  status: statementStatusSchema,
  period: statementPeriod,
  detail: statementDetailSchema,
  payerMask: payerMaskSchema.nullable(),
  summary: statementSummary,
  digest: z.string(),
  issuedAt: isoDate,
  expiresAt: isoDate,
  revokedAt: isoDate.nullable(),
});

export const verifyStatementOutput = z
  .object({
    statementId: z.string(),
    status: statementStatusSchema,
    businessName: z.string().nullable(),
    identityCurrent: z.boolean(),
    period: statementPeriod,
    detail: statementDetailSchema,
    summary: statementSummary,
    digest: z.string(),
    recordsAsOf: isoDate,
    issuedAt: isoDate,
    expiresAt: isoDate,
    revokedAt: isoDate.nullable(),
  })
  .nullable();

export type IdentityPreviewOutput = z.infer<typeof identityPreviewOutput>;
export type IssueStatementInput = z.infer<typeof issueStatementInput>;
export type PassportStatement = z.infer<typeof passportStatement>;
export type StatementMonth = z.infer<typeof statementMonth>;
export type StatementRow = z.infer<typeof statementRow>;
export type StatementOutput = z.infer<typeof statementOutput>;
export type StatementListItem = z.infer<typeof statementListItem>;
export type VerifyStatementOutput = z.infer<typeof verifyStatementOutput>;
