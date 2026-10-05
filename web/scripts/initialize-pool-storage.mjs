#!/usr/bin/env node

import { MongoClient } from "mongodb";
import {
  loadPoolStorageConfig,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

let config;
try {
  config = loadPoolStorageConfig(parsePoolStorageArgs(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(
    "Usage: initialize-pool-storage.mjs --env-file=PATH --expected-database=NAME [--allow-shared-database]\n",
  );
  process.exit(2);
}

const name = (base) => `${base}__${config.scope}`;
const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 8_000 });
await client.connect();
try {
  const db = client.db(config.databaseName);
  await Promise.all([
    db
      .collection(name("deposits"))
      .createIndex({ ledger: 1 }, { name: "ledger_asc" }),
    db
      .collection(name("spent_nullifiers"))
      .createIndex({ ledger: 1, _id: 1 }, { name: "ledger_id_asc" }),
    db.collection(name("pool_fees")).createIndex({ txHash: 1 }),
    db.collection(name("pool_fees")).createIndex({ ledger: 1 }),
    db
      .collection(name("pool_fees"))
      .createIndex({ feeRecipient: 1, ledger: 1 }),
    db.collection(name("pool_fees")).createIndex(
      { quoteId: 1 },
      {
        name: "fee_quote_id",
        unique: true,
        partialFilterExpression: { quoteId: { $type: "string" } },
      },
    ),
    db
      .collection(name("cctp_relays"))
      .createIndex({ state: 1, leaseUntil: 1 }, { name: "relay_state_lease" }),
    db.collection(name("cctp_relays")).createIndex(
      { quoteId: 1 },
      {
        name: "relay_quote_id",
        unique: true,
        partialFilterExpression: { quoteId: { $type: "string" } },
      },
    ),
    db
      .collection(name("async_fee_quote_contexts"))
      .createIndex(
        { expiresAt: 1 },
        { name: "async_quote_expiry", expireAfterSeconds: 0 },
      ),
  ]);
  const { up: initializeSessions } = await import("../migrations/20260910090000-cctp-sessions.js");
  await initializeSessions(db, config.scope);
  process.stdout.write(
    `Initialized scoped pool storage for ${config.scope} in ${config.databaseName}.\n`,
  );
} finally {
  await client.close();
}
