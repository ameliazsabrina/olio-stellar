// Mongo-backed, asynchronous mirror of public pool events. Dashboard reads are
// bounded by the last published watermark and never wait for Soroban RPC.

import "server-only";
import { randomUUID } from "node:crypto";
import { Binary, MongoServerError } from "mongodb";
import { bytesToHex } from "../../../lib/crypto";
import {
  fetchPoolEventsSince,
  networkPassphrase,
  parseDepositEvent,
  parseSpentEvent,
  poolId,
  simulateRead,
} from "../../../lib/stellar";
import {
  getDeposits,
  getIndexerState,
  getSpentNullifiers,
  type DepositDoc,
} from "../../db/mongo";
import { DepositIndexGapError } from "./deposits.errors";
import type { DepositOutput, PoolSnapshotOutput } from "./deposits.schema";

const LEASE_MS = 50_000;
const STALE_AFTER_MS = 120_000;

export type PoolSyncResult = {
  status: "synced" | "skipped" | "degraded";
  fromLedger: number;
  toLedger: number;
  depositsUpserted: number;
  nullifiersUpserted: number;
  durationMs: number;
  error?: string;
};

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

async function resetForConfiguredPool(owner: string): Promise<void> {
  const [deposits, nullifiers, states] = await Promise.all([
    getDeposits(),
    getSpentNullifiers(),
    getIndexerState(),
  ]);
  await Promise.all([deposits.deleteMany({}), nullifiers.deleteMany({})]);
  await states.updateOne(
    { _id: "pool", leaseOwner: owner },
    {
      $set: {
        poolId,
        lastLedger: 0,
        lastLeafIndex: -1,
        publishedLedger: 0,
        publishedLeafIndex: -1,
        updatedAt: new Date(),
        health: "degraded",
        lastError: "Pool mirror is awaiting its initial synchronization",
      },
      $unset: { indexedAt: "" },
    },
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
      durationMs: Date.now() - startedAt,
    };
  }

  const states = await getIndexerState();
  let fromLedger = 0;
  try {
    let state = await states.findOne({ _id: "pool" });
    if (state?.poolId !== poolId) {
      await resetForConfiguredPool(owner);
      state = await states.findOne({ _id: "pool" });
    }
    fromLedger = state?.publishedLedger ?? state?.lastLedger ?? 0;

    const { events, scannedFromLedger, latestLedger } =
      await fetchPoolEventsSince(fromLedger);
    if (fromLedger > 0 && scannedFromLedger !== fromLedger + 1) {
      throw new Error(
        `RPC retention gap: requested ledger ${fromLedger + 1}, started at ${scannedFromLedger}`,
      );
    }

    const depositOps = [];
    const nullifierOps = [];
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
    }

    const [deposits, nullifiers] = await Promise.all([
      getDeposits(),
      getSpentNullifiers(),
    ]);
    await Promise.all([
      depositOps.length
        ? deposits.bulkWrite(depositOps, { ordered: false })
        : Promise.resolve(),
      nullifierOps.length
        ? nullifiers.bulkWrite(nullifierOps, { ordered: false })
        : Promise.resolve(),
    ]);

    const [onChainCount, mirroredCount] = await Promise.all([
      poolLeafCount(),
      deposits.countDocuments(),
    ]);
    if (onChainCount !== mirroredCount) {
      throw new DepositIndexGapError(onChainCount, mirroredCount);
    }

    const indexedAt = new Date();
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
          health: "healthy",
        },
        $unset: { lastError: "" },
      },
    );

    return {
      status: "synced",
      fromLedger,
      toLedger: latestLedger,
      depositsUpserted: depositOps.length,
      nullifiersUpserted: nullifierOps.length,
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
  const state = await states.findOne({ _id: "pool" });
  const configuredPool = state?.poolId === poolId;
  const publishedLedger = configuredPool ? (state.publishedLedger ?? 0) : 0;
  const publishedLeafIndex = configuredPool
    ? (state.publishedLeafIndex ?? -1)
    : -1;
  const indexedAt = configuredPool ? state?.indexedAt : undefined;
  const stale = !indexedAt || Date.now() - indexedAt.getTime() > STALE_AFTER_MS;
  const health =
    !configuredPool || state?.health === "degraded"
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
