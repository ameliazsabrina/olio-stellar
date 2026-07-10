import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_]+$/);

export const resolveInput = z.object({ username: usernameSchema });

export const registerInput = z.object({ username: usernameSchema });

export const byOwnerInput = z.object({
  // A passkey smart-wallet contract address (C-address) — the only wallet type.
  owner: z.string().refine(StrKey.isValidContract, "invalid Stellar address"),
});

export const resolveOutput = z
  .object({
    owner: z.string(),
    notePubkeyHex: z.string(),
    viewPubkeyHex: z.string(),
    createdAt: z.string(),
  })
  .nullable();

export const byOwnerOutput = z.string().nullable();

export type ResolveInput = z.infer<typeof resolveInput>;
export type RegisterInput = z.infer<typeof registerInput>;
export type ByOwnerInput = z.infer<typeof byOwnerInput>;
export type ResolveOutput = z.infer<typeof resolveOutput>;
export type ByOwnerOutput = z.infer<typeof byOwnerOutput>;
