import "server-only";
import { poolId } from "../../../lib/stellar";
import {
  getDb,
  getIndexerState,
  getSettlementAllocations,
} from "../../db/mongo";
import { settlementsEnabled } from "./settlements.service";

const STALE_AFTER_MS = 5 * 60_000;
const BACKLOG_LIMIT = 500;

export const SETTLEMENT_INDEXES: Record<string, string[]> = {
  invoices: ["invoice_business_number"],
  invoice_versions: ["invoice_version_unique"],
  payment_intents: ["intent_quote_id", "intent_open_expiry"],
  settlements: ["settlement_leaf", "settlement_business_time"],
  settlement_allocations: ["allocation_invoice"],
  business_keys: ["business_key_generation"],
};

export async function settlementStorageReady(): Promise<boolean> {
  const db = await getDb();
  for (const [collection, required] of Object.entries(SETTLEMENT_INDEXES)) {
    try {
      const names = new Set(
        (await db.collection(collection).listIndexes().toArray()).map(
          (index) => index.name,
        ),
      );
      if (!required.every((name) => names.has(name))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export type SettlementsHealth = {
  status: "disabled" | "healthy" | "degraded";
  backlog: number;
  pendingAllocations: number;
  lastRunAt: string | null;
  degradedReasons: string[];
};

export async function settlementsHealth(
  now = new Date(),
): Promise<SettlementsHealth> {
  const states = await getIndexerState();
  const [pool, state, pendingAllocations, storageReady] = await Promise.all([
    states.findOne({ _id: "pool" }),
    states.findOne({ _id: "settlements" }),
    (await getSettlementAllocations()).countDocuments({
      appliedAt: null,
      reversedAt: null,
    }),
    settlementStorageReady(),
  ]);
  const published =
    pool?.poolId === poolId ? (pool.publishedLeafIndex ?? -1) : -1;
  const backlog = Math.max(0, published - (state?.lastLeafIndex ?? -1));
  const lastRunAt = state?.lastRunAt ?? null;
  const reasons: string[] = [];
  if (!storageReady) reasons.push("storage_not_ready");
  if (pool?.poolId !== poolId) reasons.push("pool_index_unpublished");
  else if (pool.health === "degraded") reasons.push("pool_index_degraded");
  if (state?.health === "degraded") reasons.push("reconcile_failed");
  if (backlog > BACKLOG_LIMIT) reasons.push("reconcile_backlog");
  if (!lastRunAt || now.getTime() - lastRunAt.getTime() > STALE_AFTER_MS)
    reasons.push("reconcile_stale");
  if (pendingAllocations > 0) reasons.push("allocations_pending");
  const enabled = settlementsEnabled();
  return {
    status: !enabled ? "disabled" : reasons.length ? "degraded" : "healthy",
    backlog,
    pendingAllocations,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    degradedReasons: reasons,
  };
}
