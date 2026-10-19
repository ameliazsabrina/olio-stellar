import { z } from "zod";

const ledgerSequence = z.coerce.number().int().positive();
// Goldsky sends naive UTC timestamps ("2026-09-08T04:16:22"); without a zone
// suffix `new Date` would read them as local time.
const closedAt = z
  .string()
  .min(1)
  .transform(
    (value) =>
      new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`),
  )
  .refine((date) => !Number.isNaN(date.getTime()));

export const GOLDSKY_EVENT_ID = /^(\d+)-([0-9a-f]{64})-op-(\d+)-event-(\d+)$/;

const contractId = z.string().regex(/^C[A-Z2-7]{55}$/);

// Both kinds come from the one pool_rows transform (scripts/goldsky-pipeline.mjs)
// and carry the pool the pipeline was rendered for; the webhook only counts
// rows whose pool_id is the configured pool.
export const goldskyRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event"),
    id: z.string().regex(GOLDSKY_EVENT_ID),
    pool_id: contractId,
    contract_id: contractId,
    topics: z.string().min(1),
    data: z.string(),
    transaction_hash: z.string().regex(/^[0-9a-f]{64}$/),
    transaction_index: z.coerce.number().int().nonnegative(),
    ledger_sequence: ledgerSequence,
    ledger_closed_at: closedAt,
    _gs_op: z.string().optional(),
  }),
  // A heartbeat is a marker event from another contract; its event columns
  // are accepted and stripped, only the ledger and the pool tag matter.
  z.object({
    kind: z.literal("heartbeat"),
    pool_id: contractId,
    ledger_sequence: ledgerSequence,
    ledger_closed_at: closedAt,
    _gs_op: z.string().optional(),
  }),
]);

export type GoldskyRow = z.infer<typeof goldskyRowSchema>;
