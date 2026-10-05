import { z } from "zod";
import {
  businessIdSchema,
  businessTypeSchema,
} from "../businesses/businesses.schema";

export const environmentSchema = z.enum(["sandbox", "live"]);

export const eligibilitySchema = z.enum([
  "not_started",
  "pending",
  "needs_information",
  "manual_review",
  "approved",
  "declined",
]);

export const providerStageSchema = z.enum([
  "not_started",
  "in_progress",
  "submitted",
  "on_hold",
  "completed",
]);

export const nextActionSchema = z.enum([
  "create_business",
  "start",
  "continue",
  "wait",
  "resubmit",
  "contact_support",
  "done",
]);

export const providerReviewStatusSchema = z.enum([
  "init",
  "pending",
  "prechecked",
  "queued",
  "completed",
  "onHold",
  "awaitingUser",
  "awaitingService",
]);

export const reviewAnswerSchema = z.enum(["GREEN", "RED"]);
export const rejectTypeSchema = z.enum(["FINAL", "RETRY"]);

export const credentialSummary = z.object({
  status: z.enum(["active", "suspended", "expired"]),
  issuer: z.literal("olio"),
  policyVersion: z.number().int(),
  checkedAt: z.string(),
  validUntil: z.string(),
  published: z.boolean(),
  environment: environmentSchema,
});

export const verificationStatusOutput = z.object({
  firstSubmittedAt: z.string().nullable(),
  businessId: z.string(),
  type: businessTypeSchema,
  environment: environmentSchema.nullable(),
  mode: z.enum(["off", "sandbox", "live"]),
  eligibility: eligibilitySchema,
  providerStage: providerStageSchema,
  userMessage: z.string().nullable(),
  nextAction: nextActionSchema,
  checkedAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  policyVersion: z.number().int(),
  credential: credentialSummary.nullable(),
  canStart: z.boolean(),
});

export const sdkTokenOutput = z.object({
  token: z.string(),
  expiresInSeconds: z.number().int(),
});

export const refreshOutput = z.object({
  status: verificationStatusOutput,
  reconciled: z.boolean(),
});

export const startVerificationInput = z
  .object({ businessId: businessIdSchema })
  .strict();

export const operatorCaseSummary = z.object({
  caseId: z.string(),
  firstSubmittedAt: z.string().nullable(),
  businessId: z.string(),
  environment: environmentSchema,
  applicantType: businessTypeSchema,
  eligibility: eligibilitySchema,
  reviewStatus: z.string().nullable(),
  reviewAnswer: z.string().nullable(),
  internalReasons: z.string().array(),
  revision: z.number().int(),
  providerCheckedAt: z.string().nullable(),
  reconcileAt: z.string(),
  updatedAt: z.string(),
});

export const operatorListInput = z
  .object({
    eligibility: eligibilitySchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

const webhookReviewResult = z
  .object({
    reviewAnswer: reviewAnswerSchema.optional(),
    rejectLabels: z.string().array().optional(),
    reviewRejectType: rejectTypeSchema.optional(),
  })
  .loose();

export const webhookPayload = z
  .object({
    type: z.string().min(1).max(64),
    applicantId: z.string().min(1).max(64).optional(),
    externalUserId: z.string().min(1).max(512).optional(),
    correlationId: z.string().max(128).optional(),
    reviewStatus: z.string().max(32).optional(),
    reviewResult: webhookReviewResult.optional(),
    sandboxMode: z.boolean().optional(),
    testMode: z.boolean().optional(),
    clientId: z.string().max(128).optional(),
    createdAtMs: z.string().max(64).optional(),
    levelName: z.string().max(128).optional(),
    applicantType: z.string().max(32).optional(),
  })
  .loose();

export type Eligibility = z.infer<typeof eligibilitySchema>;
export type ProviderStage = z.infer<typeof providerStageSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type VerificationStatusOutput = z.infer<typeof verificationStatusOutput>;
export type SdkTokenOutput = z.infer<typeof sdkTokenOutput>;
export type RefreshOutput = z.infer<typeof refreshOutput>;
export type CredentialSummary = z.infer<typeof credentialSummary>;
export type OperatorCaseSummary = z.infer<typeof operatorCaseSummary>;
export type WebhookPayload = z.infer<typeof webhookPayload>;
