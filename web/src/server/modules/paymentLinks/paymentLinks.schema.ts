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

const labelInput = z
  .union([z.string().trim().max(120), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    return value || null;
  });

export const createLinkInput = z
  .object({
    username: usernameSchema,
    amount: amountInput,
    label: labelInput,
  })
  .strict();

export const getLinkInput = z
  .object({ id: z.string().min(1).max(64) })
  .strict();

export const listByOwnerInput = z.object({ owner: usernameSchema }).strict();

export const linkOutput = z.object({
  id: z.string(),
  owner: z.string(),
  amount: z.string().nullable(),
  label: z.string().nullable(),
  status: z.enum(["pending", "paid"]),
  createdAt: z.string(),
});

export type CreateLinkInput = z.infer<typeof createLinkInput>;
export type GetLinkInput = z.infer<typeof getLinkInput>;
export type ListByOwnerInput = z.infer<typeof listByOwnerInput>;
export type LinkOutput = z.infer<typeof linkOutput>;
