#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import mongodb from "mongodb";
import {
  loadPoolStorageConfig,
  POOL_COLLECTION_BASES,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

const { BSON, MongoClient } = mongodb;
const { EJSON } = BSON;

const options = parsePoolStorageArgs(process.argv.slice(2));
let config;
try {
  config = loadPoolStorageConfig(options);
  if (options.execute && options.confirmScope !== config.scope) {
    throw new Error(
      "--execute requires --confirm-scope to exactly match the configured pool ID.",
    );
  }
  if (options.execute && !options.backupDir) {
    throw new Error("--execute requires an explicit --backup-dir=PATH.");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(
    "Usage: reset-pool-storage.mjs --env-file=PATH --expected-database=NAME [--allow-shared-database] [--execute --confirm-scope=POOL_ID --backup-dir=PATH]\n",
  );
  process.exit(2);
}

const collectionNames = POOL_COLLECTION_BASES.map(
  (base) => `${base}__${config.scope}`,
);
const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 8_000 });
await client.connect();
try {
  const db = client.db(config.databaseName);
  const counts = Object.fromEntries(
    await Promise.all(
      collectionNames.map(async (collectionName) => [
        collectionName,
        await db.collection(collectionName).countDocuments(),
      ]),
    ),
  );

  const nonemptyLiabilities = [
    `deposits__${config.scope}`,
    `cctp_relays__${config.scope}`,
    `async_fee_quote_contexts__${config.scope}`,
  ].filter((collectionName) => counts[collectionName] > 0);
  if (nonemptyLiabilities.length > 0) {
    throw new Error(
      `Refusing to reset nonempty liability/recovery collections: ${nonemptyLiabilities.join(", ")}.`,
    );
  }

  if (!options.execute) {
    process.stdout.write(
      `${JSON.stringify({ database: config.databaseName, scope: config.scope, counts }, null, 2)}\nDry run only; no documents were deleted.\n`,
    );
    process.exit(0);
  }

  const backupDir = path.resolve(process.cwd(), options.backupDir);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const collectionName of collectionNames) {
    const documents = await db.collection(collectionName).find({}).toArray();
    fs.writeFileSync(
      path.join(backupDir, `${collectionName}.ejson`),
      `${EJSON.stringify(documents, { relaxed: false }, 2)}\n`,
      { mode: 0o600 },
    );
  }
  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    `${JSON.stringify(
      {
        database: config.databaseName,
        scope: config.scope,
        createdAt: new Date().toISOString(),
        counts,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  await Promise.all(
    collectionNames.map((collectionName) =>
      db.collection(collectionName).deleteMany({}),
    ),
  );
  process.stdout.write(
    `Reset ${collectionNames.length} scoped collections for ${config.scope}; backup: ${backupDir}\n`,
  );
} finally {
  await client.close();
}
