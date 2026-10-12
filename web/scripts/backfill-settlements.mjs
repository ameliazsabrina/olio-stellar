#!/usr/bin/env node

import { createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import mongodb from "mongodb";
import {
  copyAsyncQuoteContexts,
  networkName,
} from "../migrations/20261007090000-invoices-settlements.js";
import {
  loadPoolStorageConfig,
  parsePoolStorageArgs,
} from "./pool-storage-config.mjs";

const { MongoClient } = mongodb;

const USAGE =
  "Usage: backfill-settlements.mjs --env-file=PATH --expected-database=NAME [--allow-shared-database] [--execute [--trigger]]";

export function unsealSessionContext(value, binding, keyHex) {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    data.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}

async function sessionContexts(db, config, network, keyHex, execute) {
  const sessions = db.collection(`cctp_sessions__${config.scope}`);
  const summary = {
    completed: 0,
    missingContext: 0,
    recovered: 0,
    unrecoverable: 0,
  };
  for await (const session of sessions.find({ result: { $exists: true } })) {
    summary.completed += 1;
    const exists = await db
      .collection("quote_contexts")
      .findOne({ _id: session.quoteId }, { projection: { _id: 1 } });
    if (exists) continue;
    summary.missingContext += 1;
    if (!keyHex) {
      summary.unrecoverable += 1;
      continue;
    }
    let context;
    try {
      context = unsealSessionContext(
        session.encryptedContext,
        session._id,
        keyHex,
      );
    } catch {
      summary.unrecoverable += 1;
      continue;
    }
    const commitment = context?.input?.feeQuote?.quote?.commitment;
    if (typeof context?.owner !== "string" || typeof commitment !== "string") {
      summary.unrecoverable += 1;
      continue;
    }
    summary.recovered += 1;
    if (!execute) continue;
    const business = await db
      .collection("business_profiles")
      .findOne({ boundAccount: context.owner }, { projection: { _id: 1 } });
    await db.collection("quote_contexts").updateOne(
      { _id: session.quoteId },
      {
        $setOnInsert: {
          _id: session.quoteId,
          channel: "cctp",
          network,
          poolId: config.scope,
          recipientOwner: context.owner,
          businessId: business?._id ?? null,
          notePubkey: context.notePubkey,
          commitment: commitment.toLowerCase(),
          paymentAmount: /^\d{1,19}$/.test(session.paymentAmount ?? "")
            ? BigInt(session.paymentAmount)
            : null,
          intentId: null,
          settlementId: null,
          source: "cctp_session",
          createdAt: session.createdAt ?? new Date(),
        },
      },
      { upsert: true },
    );
  }
  return summary;
}

async function trigger(values) {
  const base = (values.OLIO_BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  if (!values.CRON_SECRET)
    throw new Error("--trigger requires CRON_SECRET in the env file.");
  const response = await fetch(`${base}/api/cron/settlements-reconcile`, {
    method: "POST",
    headers: { authorization: `Bearer ${values.CRON_SECRET}` },
    signal: AbortSignal.timeout(300_000),
  });
  return {
    status: response.status,
    body: (await response.text()).slice(0, 2000),
  };
}

async function run() {
  const argv = process.argv.slice(2);
  const options = parsePoolStorageArgs(argv);
  let config;
  try {
    config = loadPoolStorageConfig(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exit(2);
  }
  const network = networkName(config.values);
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 8_000,
  });
  await client.connect();
  try {
    const db = client.db(config.databaseName);
    const env = { ...config.values };
    const [depositCount, settlementCount, unattributed, state] =
      await Promise.all([
        db.collection(`deposits__${config.scope}`).countDocuments(),
        db
          .collection("settlements")
          .countDocuments({ network, poolId: config.scope }),
        db.collection("settlements").countDocuments({
          network,
          poolId: config.scope,
          evidenceLevel: "unattributed",
        }),
        db
          .collection(`indexer_state__${config.scope}`)
          .findOne({ _id: "settlements" }),
      ]);
    const asyncContexts = await copyAsyncQuoteContexts(db, {
      env,
      dryRun: !options.execute,
    });
    const sessions = await sessionContexts(
      db,
      config,
      network,
      config.values.CCTP_SESSION_KEY,
      options.execute,
    );
    const summary = {
      database: config.databaseName,
      scope: config.scope,
      network,
      deposits: depositCount,
      settlements: settlementCount,
      missingSettlements: Math.max(0, depositCount - settlementCount),
      unattributed,
      reconcileWatermark: state?.lastLeafIndex ?? -1,
      asyncContexts,
      cctpSessions: sessions,
    };
    if (!options.execute) {
      process.stdout.write(
        `${JSON.stringify(summary, null, 2)}\nDry run only; no documents were written.\n`,
      );
      return;
    }
    const now = new Date();
    const reset = await db
      .collection(`indexer_state__${config.scope}`)
      .updateOne(
        {
          _id: "settlements",
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lte: now } },
          ],
        },
        { $set: { lastLeafIndex: -1, updatedAt: now } },
      );
    const result = {
      ...summary,
      watermarkReset: reset.matchedCount === 1 || !state,
    };
    if (argv.includes("--trigger"))
      result.trigger = await trigger(config.values);
    process.stdout.write(
      `${JSON.stringify(result, null, 2)}\nAttribution contexts are in place; the settlements worker re-reconciles every leaf and upgrades unattributed ones.\n`,
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
