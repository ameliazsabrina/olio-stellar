import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AnyBulkWriteOperation } from "mongodb";
import { getServerEnv } from "../../../env.server";
import { poolId } from "../../../lib/stellar";
import {
  getIndexerState,
  getRawPoolEvents,
  type RawPoolEventDoc,
} from "../../db/mongo";
import { GOLDSKY_EVENT_ID, goldskyRowSchema } from "./goldsky.schema";

// RPC event ids are a zero-padded TOID (ledger, 1-based tx order, op) plus the
// event index; rebuilding them keys archived rows exactly like the RPC mirror.
export function rpcEventId(
  ledger: number,
  transactionIndex: number,
  operationIndex: number,
  eventIndex: number,
): string {
  const toid =
    (BigInt(ledger) << 32n) |
    (BigInt(transactionIndex + 1) << 12n) |
    BigInt(operationIndex);
  return `${toid.toString().padStart(19, "0")}-${String(eventIndex).padStart(10, "0")}`;
}

// Above batch_size (100) × the largest pool event (deposit ciphertext).
export const MAX_GOLDSKY_BATCH_BYTES = 4_000_000;

export type GoldskyIngestResult =
  | { outcome: "disabled" | "unauthorized" | "malformed" }
  | {
      outcome: "stored";
      events: number;
      heartbeats: number;
      ignored: number;
      rejected: number;
    };

// Checks only the Authorization header, so the route can refuse a caller
// before it reads a single byte of the body.
export function goldskyAuthorization(
  header: string | null,
): "disabled" | "unauthorized" | "authorized" {
  const secret = getServerEnv().GOLDSKY_WEBHOOK_SECRET;
  if (!secret) return "disabled";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`))
    ? "authorized"
    : "unauthorized";
}

// Names a rejected row without echoing its payload: only the id and kind the
// sender claimed, and which fields failed.
function describeRejection(candidate: unknown, paths: string[]): string {
  const field = (key: string) => {
    const value =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)[key]
        : undefined;
    return typeof value === "string" || typeof value === "number"
      ? String(value).slice(0, 120)
      : "?";
  };
  return `id=${field("id")} kind=${field("kind")} at ${paths.join(",") || "(root)"}`;
}

const MAX_LOGGED_REJECTIONS = 20;

export async function ingestGoldskyBatch(
  raw: Buffer,
  authorization: string | null,
): Promise<GoldskyIngestResult> {
  // The route already checked; repeating it keeps this entry point safe on
  // its own.
  const auth = goldskyAuthorization(authorization);
  if (auth !== "authorized") return { outcome: auth };

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return { outcome: "malformed" };
  }
  const rows = Array.isArray(body) ? body : [body];

  const now = new Date();
  const ops: AnyBulkWriteOperation<RawPoolEventDoc>[] = [];
  let heartbeat = 0;
  let lastEventLedger = 0;
  let heartbeats = 0;
  let ignored = 0;
  let rejected = 0;
  let corrected = false;
  const rejections: string[] = [];
  for (const candidate of rows) {
    const parsed = goldskyRowSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected += 1;
      if (rejections.length < MAX_LOGGED_REJECTIONS) {
        const paths = [
          ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
        ];
        rejections.push(describeRejection(candidate, paths));
      }
      continue;
    }
    const row = parsed.data;
    // A row tagged for another pool comes from a pipeline rendered for a
    // different deployment (an old pool after a redeploy): never let it move
    // this pool's watermark or archive.
    if (row.pool_id !== poolId) {
      ignored += 1;
      continue;
    }
    // Inserts carry "i". Stellar has no reorgs, so anything else is an
    // upstream correction: keep the row and flag it for review.
    const isDelete =
      row._gs_op !== undefined && row._gs_op !== "i" && row._gs_op !== "u";
    if (row.kind === "heartbeat") {
      if (!isDelete) {
        heartbeat = Math.max(heartbeat, row.ledger_sequence);
        heartbeats += 1;
      }
      continue;
    }
    if (row.contract_id !== poolId) {
      ignored += 1;
      continue;
    }
    const [, , , op, eventIndex] = GOLDSKY_EVENT_ID.exec(row.id) ?? [];
    const _id = rpcEventId(
      row.ledger_sequence,
      row.transaction_index,
      Number(op),
      Number(eventIndex),
    );
    if (isDelete) {
      corrected = true;
      ops.push({
        updateOne: { filter: { _id }, update: { $set: { correctedAt: now } } },
      });
      continue;
    }
    lastEventLedger = Math.max(lastEventLedger, row.ledger_sequence);
    ops.push({
      updateOne: {
        filter: { _id },
        update: {
          $set: {
            goldskyId: row.id,
            ledger: row.ledger_sequence,
            txHash: row.transaction_hash,
            ledgerClosedAt: row.ledger_closed_at,
            topics: row.topics,
            data: row.data,
          },
          $setOnInsert: { receivedAt: now },
        },
        upsert: true,
      },
    });
  }

  if (rejected) {
    console.warn(
      `[goldsky] ${rejected} rejected row(s) in batch: ${rejections.join("; ")}${rejected > rejections.length ? "; ..." : ""}`,
    );
  }

  // Rows are durable before the watermark moves, so a heartbeat in this batch
  // never vouches for an event of this batch that was not written. Heartbeats
  // and events share one stream and sink, so the watermark only ever reflects
  // progress of the stream that carries the pool events.
  if (ops.length)
    await (await getRawPoolEvents()).bulkWrite(ops, { ordered: false });
  await (await getIndexerState()).updateOne(
    { _id: "goldsky" },
    {
      $max: { lastLedger: heartbeat, lastEventLedger },
      $set: {
        updatedAt: now,
        ...(heartbeats ? { heartbeatAt: now } : {}),
        ...(corrected ? { correctionAt: now } : {}),
        ...(rejected ? { lastRejectedAt: now } : {}),
      },
      $inc: { rejectedRows: rejected },
    },
    { upsert: true },
  );
  return {
    outcome: "stored",
    events: ops.length,
    heartbeats,
    ignored,
    rejected,
  };
}
