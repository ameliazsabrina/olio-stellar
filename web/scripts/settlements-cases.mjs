#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const USAGE = `Usage: settlements-cases.mjs <command> [options]

  unattributed [--limit=N]                 List unattributed deposits for this pool
  inspect <leafIndex>                      Show one deposit, its fee, attribution and settlement
  gaps                                     Report mirror gaps and reconcile backlog
  rerun <leafIndex> --reason=TEXT          Ask the server to reconcile one leaf again (audited)
  epochs [--limit=N]                       Show evidence epochs and anchor state

There is no command to mark anything paid. Settlements only come from indexed pool deposits.
Environment: MONGODB_URI, MONGO_POOL_STORAGE_SCOPE, NEXT_PUBLIC_OLIO_POOL_ID,
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE, OLIO_BASE_URL, CRON_SECRET,
SETTLEMENTS_OPERATOR=<operator identifier for audit records>`;

const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

function option(argv, name, fallback) {
  const found = argv.find((value) => value.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const asLeaf = (value) =>
  /^\d{1,10}$/.test(value ?? "") ? Number(value) : null;

export function poolContext(env) {
  const scope = env.MONGO_POOL_STORAGE_SCOPE || "";
  const poolId = env.NEXT_PUBLIC_OLIO_POOL_ID || scope;
  if (!poolId) throw new Error("NEXT_PUBLIC_OLIO_POOL_ID is required.");
  return {
    poolId,
    suffix: scope ? `__${scope}` : "",
    network:
      env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE === PUBLIC_PASSPHRASE
        ? "mainnet"
        : "testnet",
  };
}

export function summarizeSettlement(doc) {
  if (!doc) return null;
  return {
    settlementId: doc._id,
    leafIndex: doc.leafIndex,
    txHash: doc.txHash,
    eventId: doc.eventId,
    ledgerClosedAt: doc.ledgerClosedAt,
    businessId: doc.businessId,
    evidenceLevel: doc.evidenceLevel,
    rail: doc.rail,
    intentId: doc.intentId,
    amount:
      doc.amount === null || doc.amount === undefined
        ? null
        : String(doc.amount),
    allocatedAmount: String(doc.allocatedAmount ?? 0),
    refundedAmount: String(doc.refundedAmount ?? 0),
    qualification: doc.qualification,
  };
}

export async function run(
  argv,
  db,
  env = process.env,
  out = console.log,
  fetchImpl = fetch,
) {
  const [command, target] = argv.filter((value) => !value.startsWith("--"));
  const pool = poolContext(env);
  const limit = Math.min(
    500,
    Math.max(1, Number(option(argv, "--limit", "50")) || 50),
  );
  const deposits = db.collection(`deposits${pool.suffix}`);
  const fees = db.collection(`pool_fees${pool.suffix}`);
  const states = db.collection(`indexer_state${pool.suffix}`);
  const settlements = db.collection("settlements");
  const scoped = { network: pool.network, poolId: pool.poolId };

  if (command === "unattributed") {
    const items = await settlements
      .find({ ...scoped, evidenceLevel: "unattributed" })
      .sort({ leafIndex: -1 })
      .limit(limit)
      .toArray();
    out(
      JSON.stringify({ settlements: items.map(summarizeSettlement) }, null, 2),
    );
    return 0;
  }
  if (command === "inspect") {
    const leaf = asLeaf(target);
    if (leaf === null) throw new Error("inspect requires a leaf index.");
    const deposit = await deposits.findOne(
      { _id: leaf },
      { projection: { txHash: 1, eventId: 1, ledger: 1, ts: 1 } },
    );
    const fee = deposit ? await fees.findOne({ txHash: deposit.txHash }) : null;
    const context = fee
      ? await db
          .collection("quote_contexts")
          .findOne(
            { _id: fee.quoteId },
            { projection: { viewPubkey: 0, notePubkey: 0 } },
          )
      : null;
    const settlement = await settlements.findOne({
      _id: `${pool.network}:${pool.poolId}:${leaf}`,
    });
    const allocations = settlement
      ? await db
          .collection("settlement_allocations")
          .find({ settlementId: settlement._id })
          .toArray()
      : [];
    out(
      JSON.stringify(
        {
          deposit,
          fee: fee
            ? { quoteId: fee.quoteId, payer: fee.payer, ledger: fee.ledger }
            : null,
          context,
          settlement: summarizeSettlement(settlement),
          allocations: allocations.map((a) => ({
            ...a,
            amount: String(a.amount),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "gaps") {
    const [poolState, settlementState] = await Promise.all([
      states.findOne({ _id: "pool" }),
      states.findOne({ _id: "settlements" }),
    ]);
    const published = poolState?.publishedLeafIndex ?? -1;
    const mirrored = await deposits.countDocuments({
      _id: { $lte: published },
    });
    const watermark = settlementState?.lastLeafIndex ?? -1;
    const reconciled = await settlements.countDocuments({
      ...scoped,
      leafIndex: { $lte: watermark },
    });
    out(
      JSON.stringify(
        {
          publishedLeafIndex: published,
          mirrorGaps: published + 1 - mirrored,
          poolHealth: poolState?.health ?? null,
          nullifiersComplete: poolState?.nullifiersComplete ?? null,
          rootsMismatch: poolState?.rootsMismatch ?? null,
          rootLeafCount: poolState?.rootLeafCount ?? null,
          reconcileWatermark: watermark,
          reconcileBacklog: Math.max(0, published - watermark),
          missingSettlementsBelowWatermark: watermark + 1 - reconciled,
          reconcileHealth: settlementState?.health ?? null,
          reconcileError: settlementState?.lastError ?? null,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "rerun") {
    const leaf = asLeaf(target);
    if (leaf === null) throw new Error("rerun requires a leaf index.");
    const reason = option(argv, "--reason", "").trim().slice(0, 200);
    if (!reason) throw new Error("rerun requires --reason=TEXT.");
    if (!env.CRON_SECRET) throw new Error("rerun requires CRON_SECRET.");
    const base = (env.OLIO_BASE_URL || "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    const response = await fetchImpl(
      `${base}/api/cron/settlements-reconcile?leaf=${leaf}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
        signal: AbortSignal.timeout(120_000),
      },
    );
    const body = await response.text();
    const settlement = await settlements.findOne({
      _id: `${pool.network}:${pool.poolId}:${leaf}`,
    });
    await db.collection("verification_audit").insertOne({
      _id: randomBytes(16).toString("base64url"),
      actor: `operator:${env.SETTLEMENTS_OPERATOR || "unknown"}`,
      action: "operator.settlement_rerun",
      caseId: null,
      businessId: settlement?.businessId ?? "unattributed",
      fromRevision: null,
      toRevision: null,
      reasonCode: reason,
      at: new Date(),
    });
    out(
      JSON.stringify(
        {
          status: response.status,
          response: body.slice(0, 2000),
          settlement: summarizeSettlement(settlement),
        },
        null,
        2,
      ),
    );
    return response.ok ? 0 : 1;
  }
  if (command === "epochs") {
    const epochs = await db
      .collection("evidence_epochs")
      .find(scoped)
      .sort({ epoch: -1 })
      .limit(limit)
      .toArray();
    const evidenceState = await states.findOne({ _id: "evidence" });
    out(
      JSON.stringify(
        {
          evidence: evidenceState
            ? {
                health: evidenceState.health ?? null,
                lastRunAt: evidenceState.lastRunAt ?? null,
                degradedReasons: evidenceState.degradedReasons ?? [],
              }
            : null,
          epochs: epochs.map((e) => ({
            epoch: e.epoch,
            manifestHash: e.manifestHash,
            anchorState: e.anchorState,
            anchorTxHash: e.anchorTxHash,
            issuedAt: e.issuedAt,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  out(USAGE);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/olio";
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  let code = 1;
  try {
    await client.connect();
    code = await run(process.argv.slice(2), client.db());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    await client.close().catch(() => {});
  }
  process.exit(code);
}
