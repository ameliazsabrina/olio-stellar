import { z } from "zod";

export const listDepositsInput = z.object({ since: z.number().int().gte(-1).optional() }).optional();

export const depositOutput = z.object({
  leafIndex: z.number(),
  commitmentHex: z.string(),
  ephemeralPkHex: z.string(),
  ciphertextHex: z.string(),
  ledger: z.number(),
  txHash: z.string(),
  ts: z.string()
});

export type ListDepositsInput = z.infer<typeof listDepositsInput>;
export type DepositOutput = z.infer<typeof depositOutput>;
