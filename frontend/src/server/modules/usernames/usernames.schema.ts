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

export const byOwnerInput = z.object({
  owner: z.string().refine(StrKey.isValidEd25519PublicKey, "invalid Stellar address")
});

export const resolveOutput = z
  .object({
    owner: z.string(),
    notePubkeyHex: z.string(),
    viewPubkeyHex: z.string(),
    createdAt: z.string()
  })
  .nullable();

export type ResolveInput = z.infer<typeof resolveInput>;
export type ByOwnerInput = z.infer<typeof byOwnerInput>;
export type ResolveOutput = z.infer<typeof resolveOutput>;
