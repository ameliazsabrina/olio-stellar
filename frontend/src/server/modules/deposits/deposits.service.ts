// Mongo-backed mirror of pool `deposit` events. Lazily syncs new events from
// Soroban RPC on each call (no standalone worker) so notes stay discoverable
// past RPC's short event-retention window. Only ever stores what's already
// public/encrypted on-chain — no keys, no plaintext amounts.

import "server-only";
import { Binary } from "mongodb";
import { getDeposits, getIndexerState } from "../../db/mongo";
import { fetchPoolEventsSince, parseDepositEvent, poolId, simulateRead } from "../../../lib/stellar";
import { bytesToHex } from "../../../lib/crypto";
import { DepositIndexGapError } from "./deposits.errors";
import type { DepositOutput } from "./deposits.schema";

async function poolLeafCount(): Promise<number> {
  return Number(await simulateRead(poolId, "leaf_count", []));
}

// Single-flight guard: concurrent calls within one server process await the
// same sync instead of redundantly re-scanning RPC. Correctness across
// multiple processes is guaranteed by the `$max` cursor update below, not by
// this guard.
let syncInFlight: Promise<void> | null = null;

export async function syncPoolDeposits(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSyncPoolDeposits().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function doSyncPoolDeposits(): Promise<void> {
  const indexerState = await getIndexerState();
  const cursor = await indexerState.findOne({ _id: "pool" });
  const lastLedger = cursor?.lastLedger ?? 0;

  const { events, latestLedger } = await fetchPoolEventsSince(lastLedger);

  const deposits = await getDeposits();
  let maxLeafIndex = cursor?.lastLeafIndex ?? -1;

  for (const e of events) {
    const parsed = parseDepositEvent(e);
    if (!parsed) continue; // withdraw event, not a deposit
    await deposits.updateOne(
      { _id: parsed.leafIndex },
      {
        $set: {
          commitment: new Binary(Buffer.from(parsed.commitment)),
          ephemeralPk: new Binary(Buffer.from(parsed.ephemeralPk)),
          ciphertext: new Binary(Buffer.from(parsed.ciphertext)),
          ledger: e.ledger,
          txHash: e.txHash,
          ts: new Date(e.ledgerClosedAt)
        }
      },
      { upsert: true }
    );
    if (parsed.leafIndex > maxLeafIndex) maxLeafIndex = parsed.leafIndex;
  }

  // $max (not $set) so a slow/late concurrent writer can never regress the
  // cursor across processes.
  await indexerState.findOneAndUpdate(
    { _id: "pool" },
    { $max: { lastLedger: latestLedger, lastLeafIndex: maxLeafIndex }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );

  // Completeness check. `deposits._id` is a positional Merkle leaf index —
  // every user's Merkle proof is built from the full contiguous leaf array
  // (see scanMyNotes in lib/notes.ts). A single missing leafIndex, even one
  // belonging to a different user, breaks proofs for the whole pool. Fail
  // loud rather than silently serving a gapped array.
  const [onChainCount, mongoCount] = await Promise.all([poolLeafCount(), deposits.countDocuments()]);
  if (onChainCount !== mongoCount) {
    throw new DepositIndexGapError(onChainCount, mongoCount);
  }
}

export async function listDeposits(since: number): Promise<DepositOutput[]> {
  await syncPoolDeposits();
  const deposits = await getDeposits();
  const docs = await deposits
    .find({ _id: { $gt: since } })
    .sort({ _id: 1 })
    .toArray();
  return docs.map((d) => ({
    leafIndex: d._id,
    commitmentHex: bytesToHex(d.commitment.buffer),
    ephemeralPkHex: bytesToHex(d.ephemeralPk.buffer),
    ciphertextHex: bytesToHex(d.ciphertext.buffer),
    ledger: d.ledger,
    txHash: d.txHash,
    ts: d.ts.toISOString()
  }));
}
