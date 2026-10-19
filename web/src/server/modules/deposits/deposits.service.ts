// Mongo-backed, asynchronous mirror of public pool events. Dashboard reads are
// bounded by the last published watermark and never wait for Soroban RPC.

import "server-only";
import { randomUUID } from "node:crypto";
import { Binary, MongoServerError } from "mongodb";
import { getServerEnv } from "../../../env.server";
import { bytesToHex } from "../../../lib/crypto";
import {
  fetchPoolEventsSince,
  networkPassphrase,
  type PoolEvent,
  parseDepositEvent,
  parseFeeEvent,
  parseSpentEvent,
  parseWithdrawEvent,
  poolId,
  simulateRead,
} from "../../../lib/stellar";
import {
  type DepositDoc,
  getDeposits,
  getFees,
  getIndexerState,
  getSpentNullifiers,
  getWithdrawals,
  type IncompleteCause,
  type IndexerStateDoc,
  type PendingGap,
} from "../../db/mongo";
import {
  fillRetentionGap,
  type GapFillReason,
} from "../goldsky/goldsky.events";
import { I64_MAX } from "../invoices/invoices.state";
import {
  DepositIndexGapError,
  POOL_INDEXER_GAP_MESSAGE,
  POOL_INDEXER_ROOT_MESSAGE,
  PoolConfigurationMismatchError,
} from "./deposits.errors";
import {
  advancePoolRoots,
  checkRootAtTip,
  type RootCheck,
  serializeFrontier,
} from "./deposits.roots";
import type { DepositOutput, PoolSnapshotOutput } from "./deposits.schema";

const LEASE_MS = 50_000;
const STALE_AFTER_MS = 120_000;

export type PoolSyncResult = {
  status: "synced" | "skipped" | "degraded";
  fromLedger: number;
  toLedger: number;
  depositsUpserted: number;
  nullifiersUpserted: number;
  feesUpserted: number;
  withdrawalsUpserted: number;
  rootCheck: RootCheck | "failed" | "skipped";
  durationMs: number;
  error?: string;
  gapFill?: "filled" | GapFillReason;
  pendingGapsFilled?: number;
  pendingGaps?: number;
};

// Overlapping or adjacent ranges become one; it keeps the earliest sighting
// and the refusal reason of the range that reaches furthest.
export function mergePendingGaps(gaps: PendingGap[]): PendingGap[] {
  const merged: PendingGap[] = [];
  for (const gap of [...gaps].sort((a, b) => a.fromLedger - b.fromLedger)) {
    const last = merged.at(-1);
    if (!last || gap.fromLedger > last.toLedger + 1) {
      merged.push({ ...gap });
      continue;
    }
    if (gap.toLedger >= last.toLedger) {
      last.toLedger = gap.toLedger;
      last.lastReason = gap.lastReason;
    }
    if (gap.firstSeenAt < last.firstSeenAt) last.firstSeenAt = gap.firstSeenAt;
  }
  return merged;
}

type RootProgress = {
  check: RootCheck | "failed";
  fields: Partial<IndexerStateDoc>;
};

async function advanceRoots(
  state: IndexerStateDoc | null,
  leafCount: number,
): Promise<RootProgress> {
  try {
    const roots = await advancePoolRoots(state, leafCount);
    const check = await checkRootAtTip(roots, poolLeafCount);
    return {
      check,
      fields: {
        rootLeafCount: roots.leafCount,
        rootFrontier: serializeFrontier(roots.frontier),
        ...(check === "unverified"
          ? {}
          : { rootsMismatch: check === "mismatch" }),
        ...(check === "match" ? { rootsVerifiedAt: new Date() } : {}),
      },
    };
  } catch (error) {
    console.warn(
      "[pool-indexer] pool root mirror failed",
      error instanceof Error ? error.message : String(error),
    );
    return { check: "failed", fields: { rootsMismatch: true } };
  }
}

async function poolLeafCount(): Promise<number> {
  return Number(await simulateRead(poolId, "leaf_count", []));
}

async function acquireLease(owner: string): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const states = await getIndexerState();
  try {
    const state = await states.findOneAndUpdate(
      {
        _id: "pool",
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
          { leaseOwner: owner },
        ],
      },
      {
        $set: { leaseOwner: owner, leaseUntil },
        $setOnInsert: { lastLedger: 0, updatedAt: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    return state?.leaseOwner === owner;
  } catch (error) {
    // An existing, leased singleton makes the upsert collide on `_id`.
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

async function releaseLease(owner: string): Promise<void> {
  const states = await getIndexerState();
  await states.updateOne(
    { _id: "pool", leaseOwner: owner },
    { $unset: { leaseOwner: "", leaseUntil: "" } },
  );
}

export async function syncPoolIndex(): Promise<PoolSyncResult> {
  const startedAt = Date.now();
  const owner = randomUUID();
  if (!(await acquireLease(owner))) {
    return {
      status: "skipped",
      fromLedger: 0,
      toLedger: 0,
      depositsUpserted: 0,
      nullifiersUpserted: 0,
      feesUpserted: 0,
      withdrawalsUpserted: 0,
      rootCheck: "skipped",
      durationMs: Date.now() - startedAt,
    };
  }

  const states = await getIndexerState();
  let fromLedger = 0;
  try {
    const state = await states.findOne({ _id: "pool" });
    if (state?.poolId && state.poolId !== poolId) {
      throw new PoolConfigurationMismatchError(state.poolId, poolId);
    }
    fromLedger = state?.publishedLedger ?? state?.lastLedger ?? 0;

    // Gaps an earlier tick could not fill get the same vouch rules again.
    const stillPending: PendingGap[] = [];
    const retriedEvents: PoolEvent[] = [];
    let pendingGapsFilled = 0;
    for (const gap of state?.pendingGaps ?? []) {
      const retry = await fillRetentionGap(
        gap.fromLedger - 1,
        gap.toLedger + 1,
      );
      if (retry.events === null) {
        stillPending.push({ ...gap, lastReason: retry.reason });
        continue;
      }
      retriedEvents.push(...retry.events);
      pendingGapsFilled += 1;
      console.info(
        `[pool-indexer] pending retention gap filled from Goldsky: ledgers ${retry.fromLedger}-${retry.toLedger}, ${retry.events.length} events`,
      );
    }

    const fetched = await fetchPoolEventsSince(fromLedger);
    const { scannedFromLedger, latestLedger } = fetched;
    // A fallback window that starts before the watermark rescans a superset;
    // only a start past it leaves ledgers unread.
    const retentionGap = fromLedger > 0 && scannedFromLedger > fromLedger + 1;
    const gapFill = retentionGap
      ? await fillRetentionGap(fromLedger, scannedFromLedger)
      : null;
    const refusal = gapFill?.events === null ? gapFill.reason : null;
    const events = [
      ...retriedEvents,
      ...(gapFill?.events ?? []),
      ...fetched.events,
    ];
    const tolerateGap =
      refusal !== null &&
      getServerEnv().POOL_INDEXER_TOLERATE_RETENTION_GAP === "true";
    // With gap fill off nothing could ever fill the gap, so it is burnt and
    // the mirror stays incomplete until an operator resets it, as before.
    const burntGap = refusal === "off" && !tolerateGap;
    const newGap: PendingGap | null =
      refusal !== null && refusal !== "off" && !tolerateGap
        ? {
            fromLedger: fromLedger + 1,
            toLedger: scannedFromLedger - 1,
            firstSeenAt: new Date(),
            lastReason: refusal,
          }
        : null;
    const pendingGaps = mergePendingGaps(
      newGap ? [...stillPending, newGap] : stillPending,
    );
    // Only a mirror that was incomplete purely because of pending gaps may
    // become complete again; any other cause stays sticky.
    const priorComplete = state?.nullifiersComplete ?? true;
    const gapsOnly =
      !burntGap &&
      (priorComplete ||
        (!!state?.incompleteCauses?.length &&
          state.incompleteCauses.every((cause) => cause === "retention_gap")));
    const nullifiersComplete = gapsOnly && pendingGaps.length === 0;
    const incompleteCauses: IncompleteCause[] | null =
      gapsOnly && pendingGaps.length > 0 ? ["retention_gap"] : null;
    if (gapFill?.events) {
      console.info(
        `[pool-indexer] retention gap filled from Goldsky: ledgers ${gapFill.fromLedger}-${gapFill.toLedger}, ${gapFill.events.length} events`,
      );
    } else if (retentionGap) {
      console.warn(
        `[pool-indexer] retention gap: watermark ledger ${fromLedger + 1}, RPC resumed at ${scannedFromLedger}; Goldsky gap fill ${refusal}; spend events in the gap may be unindexed (${tolerateGap ? "tolerated by POOL_INDEXER_TOLERATE_RETENTION_GAP" : newGap ? "nullifier mirror marked incomplete; gap kept pending for retry" : "nullifier mirror marked incomplete"})`,
      );
    }

    const depositOps = [];
    const nullifierOps = [];
    const feeOps = [];
    const withdrawalOps = [];
    for (const event of events) {
      const deposit = parseDepositEvent(event);
      if (deposit) {
        depositOps.push({
          updateOne: {
            filter: { _id: deposit.leafIndex },
            update: {
              $set: {
                commitment: new Binary(Buffer.from(deposit.commitment)),
                ephemeralPk: new Binary(Buffer.from(deposit.ephemeralPk)),
                ciphertext: new Binary(Buffer.from(deposit.ciphertext)),
                ledger: event.ledger,
                txHash: event.txHash,
                eventId: event.id,
                ts: new Date(event.ledgerClosedAt),
              },
            },
            upsert: true,
          },
        });
      }
      const withdrawal = parseWithdrawEvent(event);
      if (withdrawal && withdrawal.amount <= I64_MAX) {
        withdrawalOps.push({
          updateOne: {
            filter: { _id: withdrawal.nullifierHex },
            update: {
              $set: {
                dest: withdrawal.dest,
                amount: withdrawal.amount,
                txHash: event.txHash,
                eventId: event.id,
                ledger: event.ledger,
                ts: new Date(event.ledgerClosedAt),
              },
            },
            upsert: true,
          },
        });
      }
      const spent = parseSpentEvent(event);
      if (spent) {
        nullifierOps.push({
          updateOne: {
            filter: { _id: spent.nullifierHex },
            update: {
              $set: {
                ledger: event.ledger,
                eventId: event.id,
                txHash: event.txHash,
                ts: new Date(event.ledgerClosedAt),
              },
            },
            upsert: true,
          },
        });
      }
      const fee = parseFeeEvent(event);
      if (fee) {
        feeOps.push({
          updateOne: {
            filter: { _id: event.id },
            update: {
              $set: {
                txHash: event.txHash,
                ledger: event.ledger,
                payer: fee.payer,
                feeRecipient: fee.feeRecipient,
                paymentAmount: fee.paymentAmount.toString(),
                feeAmount: fee.feeAmount.toString(),
                totalAmount: fee.totalAmount.toString(),
                policyVersion: fee.policyVersion,
                feeBps: fee.feeBps,
                quoteId: fee.quoteId,
                ts: new Date(event.ledgerClosedAt),
              },
            },
            upsert: true,
          },
        });
      }
    }

    const [deposits, nullifiers, fees, withdrawals] = await Promise.all([
      getDeposits(),
      getSpentNullifiers(),
      getFees(),
      getWithdrawals(),
    ]);
    await Promise.all([
      depositOps.length
        ? deposits.bulkWrite(depositOps, { ordered: false })
        : Promise.resolve(),
      nullifierOps.length
        ? nullifiers.bulkWrite(nullifierOps, { ordered: false })
        : Promise.resolve(),
      feeOps.length
        ? fees.bulkWrite(feeOps, { ordered: false })
        : Promise.resolve(),
      withdrawalOps.length
        ? withdrawals.bulkWrite(withdrawalOps, { ordered: false })
        : Promise.resolve(),
    ]);

    const [onChainCount, mirroredCount] = await Promise.all([
      poolLeafCount(),
      deposits.countDocuments(),
    ]);
    if (onChainCount !== mirroredCount) {
      throw new DepositIndexGapError(onChainCount, mirroredCount);
    }

    const roots = await advanceRoots(state, onChainCount);
    const rootsMismatch =
      roots.fields.rootsMismatch ?? state?.rootsMismatch ?? false;
    const indexedAt = new Date();
    const healthy = nullifiersComplete && !rootsMismatch;
    const unset: Partial<
      Record<"lastError" | "pendingGaps" | "incompleteCauses", "">
    > = {
      ...(healthy ? { lastError: "" } : {}),
      ...(pendingGaps.length === 0 && state?.pendingGaps
        ? { pendingGaps: "" }
        : {}),
      ...(!incompleteCauses && state?.incompleteCauses
        ? { incompleteCauses: "" }
        : {}),
    };
    await states.updateOne(
      { _id: "pool", leaseOwner: owner },
      {
        $set: {
          poolId,
          lastLedger: latestLedger,
          lastLeafIndex: onChainCount - 1,
          publishedLedger: latestLedger,
          publishedLeafIndex: onChainCount - 1,
          indexedAt,
          updatedAt: indexedAt,
          nullifiersComplete,
          ...(incompleteCauses ? { incompleteCauses } : {}),
          ...(pendingGaps.length ? { pendingGaps } : {}),
          ...(tolerateGap ? { retentionGapToleratedAt: indexedAt } : {}),
          ...(gapFill?.events || pendingGapsFilled
            ? { retentionGapFilledAt: indexedAt }
            : {}),
          ...roots.fields,
          health: healthy ? "healthy" : "degraded",
          ...(healthy
            ? {}
            : {
                lastError: nullifiersComplete
                  ? POOL_INDEXER_ROOT_MESSAGE
                  : POOL_INDEXER_GAP_MESSAGE,
              }),
        },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
    );

    return {
      status: "synced",
      fromLedger,
      toLedger: latestLedger,
      depositsUpserted: depositOps.length,
      nullifiersUpserted: nullifierOps.length,
      feesUpserted: feeOps.length,
      withdrawalsUpserted: withdrawalOps.length,
      rootCheck: roots.check,
      ...(gapFill
        ? { gapFill: gapFill.events ? "filled" : gapFill.reason }
        : {}),
      ...(pendingGapsFilled || pendingGaps.length
        ? { pendingGapsFilled, pendingGaps: pendingGaps.length }
        : {}),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Indexer sync failed";
    await states.updateOne(
      { _id: "pool", leaseOwner: owner },
      {
        $set: {
          health: "degraded",
          lastError: message,
          updatedAt: new Date(),
        },
      },
    );
    return {
      status: "degraded",
      fromLedger,
      toLedger: fromLedger,
      depositsUpserted: 0,
      nullifiersUpserted: 0,
      feesUpserted: 0,
      withdrawalsUpserted: 0,
      rootCheck: "skipped",
      durationMs: Date.now() - startedAt,
      error: message,
    };
  } finally {
    await releaseLease(owner);
  }
}

function toDepositOutput(d: DepositDoc): DepositOutput {
  return {
    leafIndex: d._id,
    commitmentHex: bytesToHex(d.commitment.buffer),
    ephemeralPkHex: bytesToHex(d.ephemeralPk.buffer),
    ciphertextHex: bytesToHex(d.ciphertext.buffer),
    ledger: d.ledger,
    txHash: d.txHash,
    ts: d.ts.toISOString(),
  };
}

let healInFlight: Promise<PoolSyncResult> | null = null;
let lastHealAttempt = 0;
const HEAL_COOLDOWN_MS = 15_000;

function healMirror(): Promise<PoolSyncResult> {
  if (healInFlight) return healInFlight;
  lastHealAttempt = Date.now();
  healInFlight = syncPoolIndex().finally(() => {
    healInFlight = null;
  });
  return healInFlight;
}

export async function getPoolSnapshot(
  afterLeafIndex: number,
  spentAfterLedger: number,
): Promise<PoolSnapshotOutput> {
  const startedAt = Date.now();
  const [states, deposits, nullifiers] = await Promise.all([
    getIndexerState(),
    getDeposits(),
    getSpentNullifiers(),
  ]);
  let state = await states.findOne({ _id: "pool" });

  const published =
    state?.poolId === poolId &&
    typeof state.publishedLedger === "number" &&
    typeof state.publishedLeafIndex === "number";
  const cooled = Date.now() - lastHealAttempt > HEAL_COOLDOWN_MS;
  if (!published) {
    if (healInFlight || cooled) {
      await healMirror().catch(() => {});
      state = await states.findOne({ _id: "pool" });
    }
  } else {
    const isStale =
      !state?.indexedAt ||
      Date.now() - state.indexedAt.getTime() > STALE_AFTER_MS;
    if (isStale && (healInFlight || cooled)) void healMirror().catch(() => {});
  }
  const configuredPool = state?.poolId === poolId;
  const publishedLedger = configuredPool ? (state?.publishedLedger ?? 0) : 0;
  const publishedLeafIndex = configuredPool
    ? (state?.publishedLeafIndex ?? -1)
    : -1;
  const indexedAt = configuredPool ? state?.indexedAt : undefined;
  const stale = !indexedAt || Date.now() - indexedAt.getTime() > STALE_AFTER_MS;
  const health =
    !configuredPool ||
    state?.health === "degraded" ||
    state?.nullifiersComplete === false
      ? "degraded"
      : stale
        ? "stale"
        : "healthy";

  const [depositDocs, spentDocs] = await Promise.all([
    deposits
      .find({ _id: { $gt: afterLeafIndex, $lte: publishedLeafIndex } })
      .sort({ _id: 1 })
      .toArray(),
    nullifiers
      .find({ ledger: { $gt: spentAfterLedger, $lte: publishedLedger } })
      .sort({ ledger: 1, _id: 1 })
      .toArray(),
  ]);

  const snapshot: PoolSnapshotOutput = {
    deposits: depositDocs.map(toDepositOutput),
    spentNullifiers: spentDocs.map((doc) => ({
      nullifierHex: doc._id,
      ledger: doc.ledger,
      ts: doc.ts.toISOString(),
    })),
    index: {
      poolId,
      networkPassphrase,
      publishedLedger,
      publishedLeafIndex,
      indexedAt: indexedAt?.toISOString() ?? new Date(0).toISOString(),
      health,
    },
  };
  console.info(
    "[pool-snapshot]",
    JSON.stringify({
      durationMs: Date.now() - startedAt,
      deposits: snapshot.deposits.length,
      nullifiers: snapshot.spentNullifiers.length,
      publishedLedger,
      health,
    }),
  );
  return snapshot;
}

// Compatibility query for callers deployed before `deposits.snapshot`.
export async function listDeposits(since: number): Promise<DepositOutput[]> {
  const snapshot = await getPoolSnapshot(since, Number.MAX_SAFE_INTEGER);
  return snapshot.deposits;
}
