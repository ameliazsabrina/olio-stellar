import { z } from "zod";

export const listDepositsInput = z
  .object({ since: z.number().int().gte(-1).optional() })
  .optional();

export const depositOutput = z.object({
  leafIndex: z.number(),
  commitmentHex: z.string(),
  ephemeralPkHex: z.string(),
  ciphertextHex: z.string(),
  ledger: z.number(),
  txHash: z.string(),
  ts: z.string(),
});

export const poolSnapshotInput = z
  .object({
    afterLeafIndex: z.number().int().gte(-1).optional(),
    spentAfterLedger: z.number().int().nonnegative().optional(),
  })
  .optional();

export const poolSnapshotOutput = z.object({
  deposits: depositOutput.array(),
  spentNullifiers: z
    .object({
      nullifierHex: z.string().regex(/^[0-9a-f]{64}$/),
      ledger: z.number().int().nonnegative(),
    })
    .array(),
  index: z.object({
    poolId: z.string(),
    networkPassphrase: z.string(),
    publishedLedger: z.number().int().nonnegative(),
    publishedLeafIndex: z.number().int().gte(-1),
    indexedAt: z.string(),
    health: z.enum(["healthy", "stale", "degraded"]),
  }),
});

export type ListDepositsInput = z.infer<typeof listDepositsInput>;
export type DepositOutput = z.infer<typeof depositOutput>;
export type PoolSnapshotOutput = z.infer<typeof poolSnapshotOutput>;
