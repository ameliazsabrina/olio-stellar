import { z } from "zod";
import { usernameSchema } from "../usernames/usernames.schema";

const USDC_DECIMALS = 7;

function decimalToBaseUnits(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return (
    BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) +
    BigInt(fracPadded || "0")
  );
}

const amountInput = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === "")
      return null;
    const trimmed = value.trim();
    if (!/^\d+(\.\d{0,7})?$/.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid USDC amount." });
      return z.NEVER;
    }
    const units = decimalToBaseUnits(trimmed);
    if (units <= 0n) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an amount greater than zero.",
      });
      return z.NEVER;
    }
    return units.toString();
  });

const amountFormField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === "")
      return null;
    const trimmed = value.trim();
    if (!/^\d+(\.\d{0,7})?$/.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid USDC amount." });
      return z.NEVER;
    }
    if (decimalToBaseUnits(trimmed) <= 0n) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an amount greater than zero.",
      });
      return z.NEVER;
    }
    return trimmed;
  });

const slugInput = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(64, "Use 64 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );

const descriptionInput = z
  .union([z.string().trim().max(500), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    return value || null;
  });

const labelInput = z
  .union([z.string().trim().max(120), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return undefined;
    return value || undefined;
  });

export const createLinkInput = z
  .object({
    username: usernameSchema,
    slug: slugInput,
    amount: amountInput,
    description: descriptionInput,
    label: labelInput.optional(),
  })
  .strict()
  .transform(({ label, ...input }) => ({
    ...input,
    description: input.description ?? label ?? null,
  }));

// Client-form counterpart of createLinkInput; keeps the raw decimal amount.
export const createLinkFormInput = z
  .object({
    username: usernameSchema,
    slug: slugInput,
    amount: amountFormField,
    description: descriptionInput,
  })
  .strict();

export const getLinkInput = z
  .object({ id: z.string().min(1).max(64) })
  .strict();

export const listByOwnerInput = z.object({ owner: usernameSchema }).strict();

export const resolveLinkInput = z
  .object({ owner: usernameSchema, slug: slugInput })
  .strict();

const manageTokenInput = z.string().min(1).max(128);

export const updateLinkInput = z
  .object({
    id: z.string().min(1).max(64),
    manageToken: manageTokenInput,
    amount: amountInput,
    description: descriptionInput,
  })
  .strict();

export const archiveLinkInput = z
  .object({
    id: z.string().min(1).max(64),
    manageToken: manageTokenInput,
    archived: z.boolean(),
  })
  .strict();

export const deleteLinkInput = z
  .object({
    id: z.string().min(1).max(64),
    manageToken: manageTokenInput,
  })
  .strict();

export const linkOutput = z.object({
  id: z.string(),
  owner: z.string(),
  slug: z.string(),
  amount: z.string().nullable(),
  description: z.string().nullable(),
  label: z.string().nullable(),
  status: z.enum(["pending", "paid"]),
  state: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

// Raw manage token is returned exactly once, at creation; never on reads.
export const createLinkResult = linkOutput.extend({
  manageToken: z.string(),
});

export type CreateLinkInput = z.infer<typeof createLinkInput>;
export type GetLinkInput = z.infer<typeof getLinkInput>;
export type ListByOwnerInput = z.infer<typeof listByOwnerInput>;
export type ResolveLinkInput = z.infer<typeof resolveLinkInput>;
export type UpdateLinkInput = z.infer<typeof updateLinkInput>;
export type ArchiveLinkInput = z.infer<typeof archiveLinkInput>;
export type DeleteLinkInput = z.infer<typeof deleteLinkInput>;
export type LinkOutput = z.infer<typeof linkOutput>;
export type CreateLinkResult = z.infer<typeof createLinkResult>;
