import { z } from "zod";
import {
  businessIdSchema,
  businessTypeSchema,
  publicIdSchema,
} from "../businesses/businesses.schema";
import { credentialSummary } from "../verification/verification.schema";

export const identityPreviewOutput = z.object({
  businessId: z.string(),
  publicId: z.string(),
  displayName: z.string().nullable(),
  type: businessTypeSchema,
  credential: credentialSummary.nullable(),
  publishable: z.boolean(),
  publicPath: z.string().nullable(),
});

export const setVisibilityInput = z
  .object({ businessId: businessIdSchema, published: z.boolean() })
  .strict();

export const publicIdentityInput = z
  .object({ publicId: publicIdSchema })
  .strict();

export const publicIdentityOutput = z
  .object({
    publicId: z.string(),
    displayName: z.string().nullable(),
    type: businessTypeSchema,
    verified: z.literal(true),
    issuer: z.literal("olio"),
    scope: z.literal("identity"),
    policyVersion: z.number().int(),
    checkedAt: z.string(),
    validUntil: z.string(),
  })
  .nullable();

export type IdentityPreviewOutput = z.infer<typeof identityPreviewOutput>;
export type SetVisibilityInput = z.infer<typeof setVisibilityInput>;
export type PublicIdentityOutput = z.infer<typeof publicIdentityOutput>;
