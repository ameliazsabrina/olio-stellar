#!/usr/bin/env node

import { createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const USAGE = `Usage: cctp-sessions.mjs <command> [options]

  list [--stage=STAGE] [--limit=N]     Summarize sessions (default: needs_attention)
  inspect <sessionId> [--reveal]       Show one session; --reveal decrypts recovery context
  requeue <sessionId>                  Return a needs_attention session to the worker queue
  circuits                             Show Iris circuit breaker state per source domain
  circuit-reset <domain>               Clear failures, backoff, and the denied flag for a domain

Environment: MONGODB_URI, MONGO_POOL_STORAGE_SCOPE, CCTP_SESSION_KEY (inspect --reveal only)`;

const ACTIVE_STAGES = ["submission_unknown", "source_submitted", "confirming_source", "awaiting_attestation", "minting", "minted", "depositing"];

export function sessionsCollectionName(scope = process.env.MONGO_POOL_STORAGE_SCOPE) {
  if (scope && !/^[A-Za-z0-9_-]{1,64}$/.test(scope)) throw new Error("Invalid MONGO_POOL_STORAGE_SCOPE.");
  return scope ? `cctp_sessions__${scope}` : "cctp_sessions";
}

export function unseal(value, binding, keyHex = process.env.CCTP_SESSION_KEY) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex ?? "")) throw new Error("CCTP_SESSION_KEY is required to reveal recovery context.");
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
}

export function summarize(session, now = Date.now()) {
  return {
    sessionId: session._id,
    stage: session.stage,
    sourceDomain: session.sourceDomain,
    sourceTxHash: session.sourceTxHash ?? null,
    errorCode: session.errorCode ?? null,
    attempts: session.attempts,
    ageMinutes: Math.round((now - new Date(session.createdAt).getTime()) / 60_000),
    nextAttemptInSeconds: Math.max(0, Math.round((new Date(session.nextAttemptAt).getTime() - now) / 1000)),
    leased: Boolean(session.leaseUntil && new Date(session.leaseUntil).getTime() > now),
    totalAmount: session.totalAmount,
  };
}

export function revealContext(session, keyHex) {
  const context = unseal(session.encryptedContext, session._id, keyHex);
  const quote = context.input?.feeQuote?.quote ?? {};
  return {
    username: context.input?.username ?? null,
    owner: context.owner ?? null,
    quote: { quoteId: quote.quoteId ?? null, sourceDomain: quote.sourceDomain ?? null, paymentAmount: quote.paymentAmount ?? null, feeAmount: quote.feeAmount ?? null, totalAmount: quote.totalAmount ?? null, expiresAt: quote.expiresAt ?? null },
  };
}

export function requeueUpdate(session, now = new Date()) {
  if (session.stage !== "needs_attention") throw new Error(`Session is in stage ${session.stage}; only needs_attention sessions can be requeued.`);
  return {
    $set: { stage: session.sourceTxHash ? "source_submitted" : "submission_unknown", attempts: 0, nextAttemptAt: now, requeuedAt: now, updatedAt: now },
    $unset: { errorCode: "", leaseOwner: "", leaseUntil: "" },
  };
}

function option(argv, name, fallback) {
  const found = argv.find((value) => value.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

export async function run(argv, db, env = process.env, out = console.log) {
  const [command, target] = argv.filter((value) => !value.startsWith("--"));
  const sessions = db.collection(sessionsCollectionName(env.MONGO_POOL_STORAGE_SCOPE));
  const rows = db.collection("cctp_coordination");
  if (command === "list") {
    const stage = option(argv, "--stage", "needs_attention");
    const limit = Math.min(500, Math.max(1, Number(option(argv, "--limit", "50")) || 50));
    const filter = stage === "active" ? { stage: { $in: ACTIVE_STAGES } } : stage === "all" ? {} : { stage };
    const items = await sessions.find(filter).sort({ nextAttemptAt: 1 }).limit(limit).toArray();
    const counts = Object.fromEntries((await sessions.aggregate([{ $group: { _id: "$stage", count: { $sum: 1 } } }]).toArray()).map((row) => [row._id, row.count]));
    out(JSON.stringify({ counts, sessions: items.map((item) => summarize(item)) }, null, 2));
    return 0;
  }
  if (command === "inspect") {
    if (!/^[a-f0-9]{64}$/.test(target ?? "")) throw new Error("inspect requires a 64-hex session id.");
    const session = await sessions.findOne({ _id: target });
    if (!session) throw new Error("Session not found.");
    const { encryptedContext, capabilityHash, ...rest } = session;
    const detail = { ...rest, ...(argv.includes("--reveal") ? { context: revealContext(session, env.CCTP_SESSION_KEY) } : {}) };
    out(JSON.stringify(detail, null, 2));
    return 0;
  }
  if (command === "requeue") {
    if (!/^[a-f0-9]{64}$/.test(target ?? "")) throw new Error("requeue requires a 64-hex session id.");
    const session = await sessions.findOne({ _id: target });
    if (!session) throw new Error("Session not found.");
    const result = await sessions.updateOne({ _id: target, stage: "needs_attention" }, requeueUpdate(session), { writeConcern: { w: "majority", j: true } });
    if (result.matchedCount !== 1) throw new Error("Session changed before requeue; inspect it again.");
    out(JSON.stringify(summarize(await sessions.findOne({ _id: target })), null, 2));
    return 0;
  }
  if (command === "circuits") {
    const circuits = await rows.find({ _id: { $regex: /^iris:circuit:\d+$/ } }).toArray();
    out(JSON.stringify(circuits.map((row) => ({ domain: Number(row._id.slice("iris:circuit:".length)), failures: row.failures ?? 0, denied: Boolean(row.denied), openUntil: row.nextAt && row.nextAt > new Date() ? row.nextAt.toISOString() : null })), null, 2));
    return 0;
  }
  if (command === "circuit-reset") {
    if (!/^\d+$/.test(target ?? "")) throw new Error("circuit-reset requires a numeric source domain.");
    await rows.updateOne({ _id: `iris:circuit:${target}` }, { $set: { failures: 0, nextAt: new Date(0), denied: false } }, { upsert: true });
    out(JSON.stringify({ domain: Number(target), reset: true }));
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
