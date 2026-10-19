#!/usr/bin/env node
// Compares the Goldsky archive with the Mongo mirror over the ledgers both
// cover; run before turning gap fill on and after any pipeline change.
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import {
  loadPoolStorageConfig,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

const ARCHIVE_SAFETY_LEDGERS = 720;

// The mirror collections, each with the pool event topic it is built from.
// pool_fees is keyed by the event id itself; the others store it as eventId.
export const MIRROR_SOURCES = [
  { collection: "deposits", kind: "deposit", idField: "eventId" },
  { collection: "spent_nullifiers", kind: "spend", idField: "eventId" },
  { collection: "withdrawals", kind: "withdraw", idField: "eventId" },
  { collection: "pool_fees", kind: "fee", idField: "_id" },
];

// The first topic of an archived row (the webhook stores topics verbatim as
// Goldsky's tagged-JSON string).
export function archiveEventKind(topics) {
  try {
    const [first] = JSON.parse(topics);
    const kind = first?.symbol ?? first?.string;
    return typeof kind === "string" ? kind : "unknown";
  } catch {
    return "unknown";
  }
}

// Diffs EVENT ids: a transaction carries several events (deposit + fee,
// spend + withdraw), so a tx-hash match would hide a missing event inside a
// matched transaction.
//   archive: [{ _id, txHash, topics }]   (pool_raw_events, within the range)
//   mirror:  [{ eventId?, txHash, kind }] (eventId absent on older docs)
// Older mirror docs without an event id can only be matched by tx hash; they
// are reported apart under legacyByTxHash.
export function diffEventIds({ archive, mirror }) {
  const archiveIds = new Set(archive.map((row) => row._id));
  const archiveTxs = new Set(archive.map((row) => row.txHash));
  const mirrorIds = new Set();
  const legacy = [];
  for (const doc of mirror) {
    if (typeof doc.eventId === "string" && doc.eventId)
      mirrorIds.add(doc.eventId);
    else legacy.push(doc);
  }
  const legacyKeys = new Set(legacy.map((doc) => `${doc.kind}:${doc.txHash}`));
  const legacyTxs = [...new Set(legacy.map((doc) => doc.txHash))];

  const missingFromMirror = {};
  for (const row of archive) {
    if (mirrorIds.has(row._id)) continue;
    const kind = archiveEventKind(row.topics);
    // The archive's event behind a legacy mirror doc is not archive-only.
    if (legacyKeys.has(`${kind}:${row.txHash}`)) continue;
    if (!missingFromMirror[kind]) missingFromMirror[kind] = [];
    missingFromMirror[kind].push(row._id);
  }
  for (const ids of Object.values(missingFromMirror)) ids.sort();

  return {
    archiveEvents: archiveIds.size,
    mirrorEvents: mirrorIds.size,
    missingFromArchive: [...mirrorIds]
      .filter((id) => !archiveIds.has(id))
      .sort(),
    legacyByTxHash: {
      compared: legacy.length,
      missingFromArchive: legacyTxs.filter((tx) => !archiveTxs.has(tx)).sort(),
    },
    // Informational: mostly admin/gov events the mirror does not index.
    missingFromMirror,
  };
}

// Parity holds when the archive is non-empty and holds every mirrored event.
export function parityPassed(diff) {
  return (
    diff.archiveEvents > 0 &&
    diff.missingFromArchive.length === 0 &&
    diff.legacyByTxHash.missingFromArchive.length === 0
  );
}

// Decides the ledger window the parity check compares. Throws rather than
// returning an empty window, so a missing state doc or an unset start ledger
// cannot pass as "parity OK".
export function parityRange({ archiveLedger, publishedLedger, startLedger }) {
  if (!Number.isInteger(archiveLedger))
    throw new Error(
      "goldsky indexer_state is missing lastLedger; run the Goldsky archive before checking parity",
    );
  if (!Number.isInteger(publishedLedger))
    throw new Error(
      "pool indexer_state is missing publishedLedger; run the pool indexer before checking parity",
    );
  if (!Number.isInteger(startLedger) || startLedger < 1)
    throw new Error(
      "GOLDSKY_PIPELINE_START_LEDGER is unset or not a positive integer",
    );
  const lower = startLedger;
  const upper = Math.min(
    archiveLedger - ARCHIVE_SAFETY_LEDGERS,
    publishedLedger,
  );
  if (upper < lower)
    throw new Error(
      `Empty parity range: lower ${lower} is above upper ${upper}`,
    );
  return { lower, upper };
}

async function main() {
  const config = loadPoolStorageConfig(
    parsePoolStorageArgs(process.argv.slice(2)),
  );
  const name = (base) => (config.scope ? `${base}__${config.scope}` : base);
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 8_000,
  });
  await client.connect();
  try {
    const db = client.db(config.databaseName);
    const states = db.collection(name("indexer_state"));
    const [archiveState, pool] = await Promise.all([
      states.findOne({ _id: "goldsky" }),
      states.findOne({ _id: "pool" }),
    ]);
    const { lower, upper } = parityRange({
      archiveLedger: archiveState?.lastLedger,
      publishedLedger: pool?.publishedLedger,
      startLedger: Number(config.values.GOLDSKY_PIPELINE_START_LEDGER),
    });
    const range = { ledger: { $gte: lower, $lte: upper } };
    const [archive, ...mirrored] = await Promise.all([
      db
        .collection(name("pool_raw_events"))
        .find(range, { projection: { txHash: 1, topics: 1 } })
        .toArray(),
      ...MIRROR_SOURCES.map(async ({ collection, kind, idField }) => {
        const docs = await db
          .collection(name(collection))
          .find(range, { projection: { txHash: 1, [idField]: 1 } })
          .toArray();
        return docs.map((doc) => ({
          eventId: doc[idField],
          txHash: doc.txHash,
          kind,
        }));
      }),
    ]);
    const diff = diffEventIds({ archive, mirror: mirrored.flat() });
    process.stdout.write(
      `${JSON.stringify({ lowerLedger: lower, upperLedger: upper, ...diff }, null, 2)}\n`,
    );
    if (diff.archiveEvents === 0) {
      process.stderr.write(
        `No archived events in ledgers ${lower}-${upper}; parity cannot be confirmed\n`,
      );
    }
    if (!parityPassed(diff)) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
