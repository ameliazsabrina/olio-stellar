#!/usr/bin/env node

// Clears the sticky `nullifiersComplete: false` flag a retention gap leaves on
// a testnet pool indexer. This is an operator assertion that no notes were
// spent during the gap; it never runs against mainnet.

import { fileURLToPath } from "node:url";
import mongodb from "mongodb";
import {
  loadPoolStorageConfig,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

const { MongoClient } = mongodb;

const USAGE =
  "Usage: pool-indexer-reset-gap.mjs --env-file=PATH --expected-database=NAME [--allow-shared-database] [--execute]";

export function assertTestnet(values) {
  if ((values.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") !== "testnet") {
    throw new Error(
      "Refusing to reset the nullifier mirror outside testnet; mainnet gaps need a full resync.",
    );
  }
}

// Returns null when there is nothing to reset; throws when the mirror is not
// otherwise consistent enough for the assertion to be meaningful.
export function planReset(state, scope, mirroredDeposits, now = new Date()) {
  if (!state) throw new Error("No pool indexer state found for this scope.");
  if (state.poolId !== scope) {
    throw new Error(
      `Indexer state belongs to pool ${state.poolId}, not ${scope}; refusing.`,
    );
  }
  if (state.nullifiersComplete !== false) return null;
  if (state.leaseUntil instanceof Date && state.leaseUntil > now) {
    throw new Error(
      "The pool indexer is mid-sync (lease held); retry in a minute.",
    );
  }
  const expectedDeposits = (state.publishedLeafIndex ?? -1) + 1;
  if (mirroredDeposits !== expectedDeposits) {
    throw new Error(
      `Deposit mirror has ${mirroredDeposits} of ${expectedDeposits} published leaves; let the indexer catch up first.`,
    );
  }
  const rootsOk = state.rootsMismatch !== true;
  return {
    summary: {
      poolId: state.poolId,
      publishedLeafIndex: state.publishedLeafIndex ?? null,
      publishedLedger: state.publishedLedger ?? null,
      health: state.health ?? null,
      lastError: state.lastError ?? null,
      rootsMismatch: state.rootsMismatch ?? null,
      // Abandoned by the reset: the assertion covers them too.
      pendingGaps: state.pendingGaps ?? [],
      healthAfterReset: rootsOk ? "healthy" : state.health ?? null,
    },
    filter: {
      _id: "pool",
      poolId: scope,
      nullifiersComplete: false,
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: { $lte: now } },
      ],
    },
    update: {
      $set: {
        nullifiersComplete: true,
        nullifierGapAcknowledgedAt: now,
        updatedAt: now,
        ...(rootsOk ? { health: "healthy" } : {}),
      },
      // Left in place, a pending gap would mark the mirror incomplete again.
      $unset: {
        pendingGaps: "",
        incompleteCauses: "",
        ...(rootsOk ? { lastError: "" } : {}),
      },
    },
  };
}

async function run() {
  const options = parsePoolStorageArgs(process.argv.slice(2));
  let config;
  try {
    config = loadPoolStorageConfig(options);
    assertTestnet(config.values);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exit(2);
  }
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 8_000,
  });
  await client.connect();
  try {
    const db = client.db(config.databaseName);
    const states = db.collection(`indexer_state__${config.scope}`);
    const state = await states.findOne({ _id: "pool" });
    const mirrored = await db
      .collection(`deposits__${config.scope}`)
      .countDocuments();
    const plan = planReset(state, config.scope, mirrored);
    if (!plan) {
      process.stdout.write(
        "The nullifier mirror is not marked incomplete; nothing to reset.\n",
      );
      return;
    }
    const summary = { database: config.databaseName, ...plan.summary };
    if (!options.execute) {
      process.stdout.write(
        `${JSON.stringify(summary, null, 2)}\nDry run only; pass --execute to clear the flag.\n`,
      );
      return;
    }
    const result = await states.updateOne(plan.filter, plan.update);
    if (result.modifiedCount !== 1) {
      throw new Error(
        "Indexer state changed concurrently; nothing was written. Re-run the command.",
      );
    }
    process.stdout.write(
      `${JSON.stringify(summary, null, 2)}\nNullifier mirror marked complete. Payment readiness rechecks within 30 seconds.\n`,
    );
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
