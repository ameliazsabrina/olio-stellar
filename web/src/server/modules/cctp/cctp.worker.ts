import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decodeAbiParameters, toEventSelector } from "viem";
import { getServerEnv } from "../../../env.server";
import { bytesToHex, fromBaseUnits } from "../../../lib/crypto";
import { parseCctpMessage } from "../../../lib/cctpMessage";
import { deserializeFeeQuoteEnvelope, stellarNetworkId } from "../../../lib/fee-quote";
import { networkPassphrase, poolId } from "../../../lib/stellar";
import { getCctpRelays, getCctpSessions, type CctpSessionDoc } from "../../db/mongo";
import { matchesQuote } from "./cctp.binding";
import { CctpOperationalError } from "./cctp.errors";
import { sourceRpc } from "./cctp.rpc";
import { sessionContext } from "./cctp.sessions";
import { relayDeposit } from "./cctp.service";
import { fetchIrisMessages, selectIrisMessage } from "./iris.client";
import { coordination } from "./cctp.storage";

const LEASE_MS = 10 * 60_000;
export const WORKER_HEARTBEAT_MS = 120_000;
export const ATTENTION_AFTER_MS = 86_400_000;
export const MAX_BACKOFF_MS = 300_000;
export const PENDING_POLL_MS = 10_000;
export const PENDING_POLL_WINDOW_MS = 30 * 60_000;
export const DEFAULT_DRAIN_BUDGET_MS = 240_000;
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export async function discoverSource(session: CctpSessionDoc): Promise<{ txHash?: string; nextBlock?: string }> {
  if (session.sourceDomain === 5 || !session.sourceScanBlock) return {};
  const from = BigInt(session.sourceScanBlock);
  const tip = BigInt(z.string().regex(/^0x[0-9a-fA-F]+$/).parse(await sourceRpc(session.sourceDomain, "eth_blockNumber")));
  // Rescan the trailing 64 blocks for reorgs; advance large backlogs in bounded windows.
  const to = tip < from + 1999n ? tip : from + 1999n;
  if (to < from) return {};
  const logs = z.array(z.object({ transactionHash: hash, data: z.string().max(20_000), removed: z.boolean().optional() })).max(1000).parse(await sourceRpc(session.sourceDomain, "eth_getLogs", [{
    address: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", topics: [toEventSelector("MessageSent(bytes)")], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`,
  }]));
  const { quote } = deserializeFeeQuoteEnvelope(sessionContext(session).input.feeQuote);
  const candidates = logs.filter(log => {
    if (log.removed) return false;
    try { return matchesQuote(decodeAbiParameters([{ type: "bytes" }], log.data as `0x${string}`)[0], quote, false); } catch { return false; }
  });
  if (candidates.length > 1) throw new CctpOperationalError("binding");
  return { txHash: candidates[0]?.transactionHash.toLowerCase(), nextBlock: `0x${(to === tip ? (to > 64n && to - 64n > from ? to - 64n : from) : to + 1n).toString(16)}` };
}

export function retryDelayMs(attempts: number, error: unknown, random = Math.random(), ageMs = 0): number {
  const jitter = 0.8 + random * 0.4;
  // Waiting on source finality or the attestation is the expected state, not a fault. Poll steadily while the
  // transfer is young so settlement lands seconds after Iris attests instead of at the end of a backoff tail;
  // only a transfer that has outlived every finality window falls back to exponential backoff.
  if (error instanceof CctpOperationalError && error.code === "pending" && ageMs < PENDING_POLL_WINDOW_MS) return PENDING_POLL_MS * jitter;
  const backoff = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(attempts, 6)) * jitter;
  return Math.max(backoff, error instanceof CctpOperationalError ? error.retryAfterMs : 60_000);
}

export function needsAttention(session: Pick<CctpSessionDoc, "createdAt" | "requeuedAt">, code: string, now = Date.now()): boolean {
  return code === "binding" || now - (session.requeuedAt ?? session.createdAt).getTime() > ATTENTION_AFTER_MS;
}

export async function refreshWorkerHeartbeat() {
  await (await coordination()).updateOne({ _id: `worker:${poolId}` }, { $set: { until: new Date(Date.now() + WORKER_HEARTBEAT_MS) } }, { upsert: true });
}

export type SettlementOutcome = { status: "idle" } | { status: "completed"; sessionId: string } | { status: "pending"; sessionId: string; errorCode: string };

export async function settleNextSession(): Promise<SettlementOutcome> {
  const sessions = await getCctpSessions();
  const network = bytesToHex(stellarNetworkId(networkPassphrase));
  const now = new Date();
  const owner = randomUUID();
  const session = await sessions.findOneAndUpdate({
    network, pool: poolId, stage: { $nin: ["completed", "awaiting_signature", "needs_attention"] }, nextAttemptAt: { $lte: now },
    $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
  }, { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: now }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, returnDocument: "after", writeConcern: { w: "majority", j: true } });
  if (!session) return { status: "idle" };
  const filter = { _id: session._id, leaseOwner: owner, leaseUntil: { $gt: new Date() } };
  let lostLease = false;
  const heartbeat = setInterval(() => {
    void refreshWorkerHeartbeat().catch(() => {});
    void sessions.updateOne({ _id: session._id, leaseOwner: owner, leaseUntil: { $gt: new Date() } }, { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).then(r => { if (r.matchedCount !== 1) lostLease = true; }).catch(() => { lostLease = true; });
  }, 30_000);
  async function checkpoint(update: Partial<CctpSessionDoc>) {
    if (lostLease) throw new CctpOperationalError("lease_lost");
    const result = await sessions.updateOne({ ...filter, leaseUntil: { $gt: new Date() } }, { $set: { ...update, updatedAt: new Date() } }, { writeConcern: { w: "majority", j: true } });
    if (result.matchedCount !== 1) throw new CctpOperationalError("lease_lost");
  }
  const started = Date.now();
  let outcome = "pending";
  try {
    const context = sessionContext(session);
    const { quote } = deserializeFeeQuoteEnvelope(context.input.feeQuote);
    // A confirmed durable deposit wins, even if Iris is down or its attestation expired.
    const relay = await (await getCctpRelays()).findOne({ quoteId: session.quoteId });
    if (relay?.state === "deposited" && relay.depositTxHash && relay.leafIndex !== undefined) {
      await checkpoint({ stage: "completed", result: { leafIndex: relay.leafIndex, paymentAmount: fromBaseUnits(BigInt(relay.paymentAmount)), feeAmount: fromBaseUnits(BigInt(relay.feeAmount)), totalAmount: fromBaseUnits(BigInt(relay.totalAmount)), feePolicyVersion: relay.policyVersion, txHash: relay.depositTxHash } });
      outcome = "completed";
      return { status: "completed", sessionId: session._id };
    }
    let txHash = session.sourceTxHash;
    if (!txHash) {
      const discovery = await discoverSource(session);
      if (discovery.nextBlock) await checkpoint({ sourceScanBlock: discovery.nextBlock });
      txHash = discovery.txHash;
      if (!txHash) throw new CctpOperationalError("pending");
      await checkpoint({ sourceTxHash: txHash, stage: "confirming_source" });
    }
    const candidate = selectIrisMessage(await fetchIrisMessages(session.sourceDomain, txHash), message => matchesQuote(message, quote));
    if (!candidate?.message || !candidate.attestation) {
      await checkpoint({ stage: "awaiting_attestation" });
      throw new CctpOperationalError("pending");
    }
    const msg = parseCctpMessage(candidate.message);
    // V2 nonce uniquely identifies the source message, including multi-message transactions.
    await checkpoint({ sourceMessageId: `${session.sourceDomain}:${bytesToHex(msg.nonce)}`, stage: relay?.state === "minted" ? "minted" : relay?.state === "depositing" ? "depositing" : "minting" });
    const result = await relayDeposit({ ...context.input, sourceTxHash: txHash, message: candidate.message, attestation: candidate.attestation }, context);
    await checkpoint({ stage: "completed", result });
    outcome = "completed";
    return { status: "completed", sessionId: session._id };
  } catch (error) {
    const code = error instanceof CctpOperationalError ? error.code : "settlement_pending";
    outcome = code;
    const delay = retryDelayMs(session.attempts, error, Math.random(), Date.now() - (session.requeuedAt ?? session.createdAt).getTime());
    await checkpoint({ errorCode: code, nextAttemptAt: new Date(Date.now() + delay), ...(needsAttention(session, code) ? { stage: "needs_attention" as const } : {}) }).catch(() => {});
    return { status: "pending", sessionId: session._id, errorCode: code };
  } finally {
    clearInterval(heartbeat);
    await sessions.updateOne({ _id: session._id, leaseOwner: owner }, { $unset: { leaseOwner: "", leaseUntil: "" } });
    console.info("[cctp-worker]", JSON.stringify({ domain: session.sourceDomain, outcome, latencyMs: Date.now() - started, ageMs: Date.now() - session.createdAt.getTime() }));
  }
}

export type WorkerRun = { status: "disabled" | "idle" | "completed" | "pending"; processed: number; completed: number; pending: number; exhausted: boolean; durationMs: number };

export async function runCctpWorker(options: { budgetMs?: number; settle?: () => Promise<SettlementOutcome> } = {}): Promise<WorkerRun> {
  const started = Date.now();
  const summary: WorkerRun = { status: "idle", processed: 0, completed: 0, pending: 0, exhausted: false, durationMs: 0 };
  if (getServerEnv().CCTP_WORKER_ENABLED !== "true") return { ...summary, status: "disabled" };
  const budgetMs = options.budgetMs ?? DEFAULT_DRAIN_BUDGET_MS;
  const settle = options.settle ?? settleNextSession;
  await refreshWorkerHeartbeat();
  const seen = new Set<string>();
  while (true) {
    const last = await settle();
    if (last.status === "idle") break;
    summary.processed++;
    if (last.status === "completed") summary.completed++;
    else summary.pending++;
    if (seen.has(last.sessionId) && last.status === "pending") break;
    seen.add(last.sessionId);
    if (Date.now() - started >= budgetMs) { summary.exhausted = true; break; }
    await refreshWorkerHeartbeat();
  }
  summary.status = summary.processed === 0 ? "idle" : summary.completed > 0 ? "completed" : "pending";
  summary.durationMs = Date.now() - started;
  return summary;
}
