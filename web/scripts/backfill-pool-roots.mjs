#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";
import mongodb from "mongodb";
import {
  loadPoolStorageConfig,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

const { MongoClient } = mongodb;

const USAGE =
  "Usage: backfill-pool-roots.mjs --env-file=PATH --expected-database=NAME [--allow-shared-database] [--execute]";

const toHex = (value) => value.toString(16).padStart(64, "0");

export async function computeRoots(commitments, depth, hash) {
  const zeros = [0n];
  for (let i = 0; i < depth; i += 1) zeros.push(await hash(zeros[i], zeros[i]));
  const frontier = zeros.slice(0, depth);
  const roots = [];
  let root = zeros[depth];
  for (let index = 0; index < commitments.length; index += 1) {
    let current = commitments[index];
    let position = index;
    for (let level = 0; level < depth; level += 1) {
      if ((position & 1) === 0) {
        frontier[level] = current;
        current = await hash(current, zeros[level]);
      } else {
        current = await hash(frontier[level], current);
      }
      position >>= 1;
    }
    root = current;
    roots.push(root);
  }
  return { roots, frontier, root };
}

async function run() {
  const options = parsePoolStorageArgs(process.argv.slice(2));
  let config;
  try {
    config = loadPoolStorageConfig(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exit(2);
  }
  const depth = Number(config.values.NEXT_PUBLIC_POOL_DEPTH || 20);
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) {
    process.stderr.write("NEXT_PUBLIC_POOL_DEPTH must be between 1 and 32.\n");
    process.exit(2);
  }
  const poseidon = await buildPoseidon();
  const hash = async (left, right) =>
    poseidon.F.toObject(poseidon([left, right]));
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 8_000,
  });
  await client.connect();
  try {
    const db = client.db(config.databaseName);
    const deposits = await db
      .collection(`deposits__${config.scope}`)
      .find({}, { projection: { commitment: 1, ledger: 1, ts: 1 } })
      .sort({ _id: 1 })
      .toArray();
    deposits.forEach((deposit, index) => {
      if (deposit._id !== index)
        throw new Error(
          `Deposit mirror gap at leaf ${index}; resync the indexer first.`,
        );
    });
    const commitments = deposits.map((deposit) =>
      BigInt(
        `0x${Buffer.from(deposit.commitment.buffer).toString("hex") || "0"}`,
      ),
    );
    const { roots, frontier, root } = await computeRoots(
      commitments,
      depth,
      hash,
    );
    const rootsCollection = db.collection(`pool_roots__${config.scope}`);
    const existing = await rootsCollection.countDocuments();
    const summary = {
      database: config.databaseName,
      scope: config.scope,
      depth,
      leafCount: deposits.length,
      existingRoots: existing,
      finalRoot: toHex(root),
    };
    if (!options.execute) {
      process.stdout.write(
        `${JSON.stringify(summary, null, 2)}\nDry run only; no documents were written.\n`,
      );
      return;
    }
    const ops = roots.map((value, index) => ({
      updateOne: {
        filter: { _id: index + 1 },
        update: {
          $set: {
            root: toHex(value),
            ledger: deposits[index].ledger,
            ts: deposits[index].ts,
          },
        },
        upsert: true,
      },
    }));
    for (let i = 0; i < ops.length; i += 1000) {
      await rootsCollection.bulkWrite(ops.slice(i, i + 1000), {
        ordered: true,
      });
    }
    await db.collection(`indexer_state__${config.scope}`).updateOne(
      { _id: "pool" },
      {
        $set: {
          rootLeafCount: deposits.length,
          rootFrontier: frontier.map(toHex),
          updatedAt: new Date(),
        },
        $unset: { rootsVerifiedAt: "", rootsMismatch: "" },
        $setOnInsert: { lastLedger: 0 },
      },
      { upsert: true },
    );
    process.stdout.write(
      `${JSON.stringify({ ...summary, written: ops.length }, null, 2)}\nRoots rebuilt; the next indexer run verifies them against the contract.\n`,
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
