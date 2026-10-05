import { z } from "zod";

export const businessTypeSchema = z.enum(["individual", "company"]);
export const businessRoleSchema = z.enum(["owner", "admin", "member"]);
export const businessLifecycleSchema = z.enum([
  "active",
  "suspended",
  "closed",
]);

export const businessIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const publicIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const displayNameInput = z
  .union([z.string().trim().max(80), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    return value || null;
  });

export const createBusinessInput = z
  .object({
    type: businessTypeSchema,
    displayName: displayNameInput,
  })
  .strict();

export const updateBusinessProfileInput = z
  .object({
    businessId: businessIdSchema,
    displayName: displayNameInput,
  })
  .strict();

export const businessIdInput = z
  .object({ businessId: businessIdSchema })
  .strict();

export const businessOutput = z.object({
  businessId: z.string(),
  publicId: z.string(),
  type: businessTypeSchema,
  lifecycle: businessLifecycleSchema,
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  accountBound: z.boolean(),
  role: businessRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const bindAccountOutput = z.object({
  business: businessOutput,
  changed: z.boolean(),
});

export type CreateBusinessInput = z.infer<typeof createBusinessInput>;
export type UpdateBusinessProfileInput = z.infer<
  typeof updateBusinessProfileInput
>;
export type BusinessIdInput = z.infer<typeof businessIdInput>;
export type BusinessOutput = z.infer<typeof businessOutput>;
export type BindAccountOutput = z.infer<typeof bindAccountOutput>;
