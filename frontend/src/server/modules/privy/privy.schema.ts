import { z } from "zod";

export const signInput = z.object({
  walletId: z.string().min(1),
  hashHex: z.string().regex(/^[0-9a-fA-F]{64}$/, "hashHex must be a 32-byte hex string")
});

export type SignInput = z.infer<typeof signInput>;
