#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import mongodb from "mongodb";
import {
  loadPoolStorageConfig,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

const { MongoClient } = mongodb;

const USAGE =
  "Usage: backfill-deposit-event-ids.mjs --env-file=PATH --expected-database=NAME [--allow-shared-database] [--execute]";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function depositLeafIndex(event) {
  const topic = event.topic?.[0];
  if (!topic || String(scValToNative(topic)) !== "deposit") return null;
  const value =
    typeof event.value === "string"
      ? xdr.ScVal.fromXDR(event.value, "base64")
      : event.value;
  const native = scValToNative(value);
  return Array.isArray(native) && native.length >= 4 ? Number(native[0]) : null;
}

async function retainedDepositEvents(server, poolId) {
  const health = await server.getHealth();
  const startLedger = Math.max(1, Number(health.oldestLedger ?? 1) + 1);
  const filters = [{ type: "contract", contractIds: [poolId] }];
  const events = [];
  let cursor;
  for (let page = 0; page < 1000; page += 1) {
    const response = await server.getEvents(
      cursor
        ? { cursor, filters, limit: 200 }
        : { startLedger, filters, limit: 200 },
    );
    events.push(...response.events);
    const next = response.cursor ?? response.events.at(-1)?.id;
    if (!next || next === cursor || response.events.length === 0) break;
    cursor = next;
  }
  return { startLedger, events };
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
  const rpcUrl =
    config.values.NEXT_PUBLIC_STELLAR_RPC_URL ||
    "https://soroban-testnet.stellar.org";
  const network =
    config.values.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE === PUBLIC_PASSPHRASE
      ? "mainnet"
      : "testnet";
  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const { startLedger, events } = await retainedDepositEvents(
    server,
    config.scope,
  );
  const byLeaf = new Map();
  for (const event of events) {
    const leafIndex = depositLeafIndex(event);
    if (leafIndex !== null) byLeaf.set(leafIndex, event);
  }
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 8_000,
  });
  await client.connect();
  try {
    const db = client.db(config.databaseName);
    const deposits = db.collection(`deposits__${config.scope}`);
    const missing = await deposits
      .find(
        { $or: [{ eventId: { $exists: false } }, { eventId: null }] },
        { projection: { txHash: 1, ledger: 1 } },
      )
      .toArray();
    const matched = [];
    let outsideRetention = 0;
    for (const deposit of missing) {
      const event = byLeaf.get(deposit._id);
      if (event && event.txHash === deposit.txHash)
        matched.push({ deposit, event });
      else outsideRetention += 1;
    }
    const summary = {
      database: config.databaseName,
      scope: config.scope,
      retentionStartLedger: startLedger,
      missingEventIds: missing.length,
      matchable: matched.length,
      outsideRetention,
    };
    if (!options.execute) {
      process.stdout.write(
        `${JSON.stringify(summary, null, 2)}\nDry run only; no documents were written.\n`,
      );
      return;
    }
    let written = 0;
    for (const { deposit, event } of matched) {
      const result = await deposits.updateOne(
        { _id: deposit._id, txHash: deposit.txHash },
        { $set: { eventId: event.id } },
      );
      written += result.modifiedCount;
      await db.collection("settlements").updateOne(
        {
          _id: `${network}:${config.scope}:${deposit._id}`,
          txHash: deposit.txHash,
          eventId: null,
        },
        { $set: { eventId: event.id, updatedAt: new Date() } },
      );
    }
    process.stdout.write(
      `${JSON.stringify({ ...summary, written }, null, 2)}\nDeposits outside RPC retention keep eventId null.\n`,
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
