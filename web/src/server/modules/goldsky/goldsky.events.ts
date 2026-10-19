import "server-only";
import {
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { getServerEnv } from "../../../env.server";
import {
  type PoolEvent,
  parseDepositEvent,
  parseFeeEvent,
  parseSpentEvent,
  parseWithdrawEvent,
} from "../../../lib/stellar";
import {
  getIndexerState,
  getRawPoolEvents,
  type RawPoolEventDoc,
} from "../../db/mongo";

// Rebuilds an xdr.ScVal from Goldsky's tagged-JSON form so the RPC parsers
// run unchanged on archived rows.
function decodeScVal(value: unknown): xdr.ScVal {
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(decodeScVal));
  const [entry] = Object.entries(value as Record<string, unknown>);
  if (!entry) throw new Error("Empty Goldsky ScVal");
  const [tag, inner] = entry;
  switch (tag) {
    case "bytes": {
      // Buffer.from(…, "hex") silently truncates at the first bad pair.
      const hex = String(inner);
      if (!/^([0-9a-f]{2})*$/i.test(hex))
        throw new Error("Goldsky bytes are not hex");
      return xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
    }
    case "symbol":
      return xdr.ScVal.scvSymbol(String(inner));
    case "string":
      return xdr.ScVal.scvString(String(inner));
    case "address":
      return Address.fromString(String(inner)).toScVal();
    case "u32":
      return xdr.ScVal.scvU32(Number(inner));
    case "u64":
    case "i64":
    case "u128":
    case "i128":
      return nativeToScVal(BigInt(String(inner)), { type: tag });
    case "vec":
      return xdr.ScVal.scvVec((inner as unknown[]).map(decodeScVal));
    case "map":
      return xdr.ScVal.scvMap(
        (inner as { key: unknown; val: unknown }[]).map(
          ({ key, val }) =>
            new xdr.ScMapEntry({
              key: decodeScVal(key),
              val: decodeScVal(val),
            }),
        ),
      );
    default:
      throw new Error(`Unsupported Goldsky ScVal tag ${tag}`);
  }
}

export function rawRowToEvent(doc: RawPoolEventDoc): PoolEvent {
  const topics: unknown = JSON.parse(doc.topics);
  if (!Array.isArray(topics)) {
    throw new Error(`Goldsky event ${doc._id} has non-array topics`);
  }
  return {
    id: doc._id,
    ledger: doc.ledger,
    ledgerClosedAt: doc.ledgerClosedAt.toISOString(),
    txHash: doc.txHash,
    topic: topics.map(decodeScVal),
    value: decodeScVal(JSON.parse(doc.data)),
  };
}

// The topics the indexer mirrors, each with the parser it uses.
const MIRRORED_PARSERS: Record<string, (event: PoolEvent) => unknown> = {
  deposit: parseDepositEvent,
  spend: parseSpentEvent,
  withdraw: parseWithdrawEvent,
  fee: parseFeeEvent,
};

// Same reading of the first topic as the lib/stellar parsers use.
function eventKind(event: PoolEvent): string | null {
  const topic = event.topic.at(0);
  return topic ? String(scValToNative(topic)) : null;
}

// One hour of ledgers. Goldsky does not order rows across a pipeline restart,
// so the archive only vouches for ledgers well behind its heartbeat.
export const GOLDSKY_HEARTBEAT_MARGIN = 720;

export type GapFillReason =
  | "off"
  | "archive_starts_late"
  | "archive_behind"
  | "archive_untrusted"
  | "corrected_rows"
  | "archive_undecodable";

export type GapFill =
  | { events: PoolEvent[]; fromLedger: number; toLedger: number }
  | { events: null; reason: GapFillReason };

export async function fillRetentionGap(
  watermark: number,
  scannedFromLedger: number,
): Promise<GapFill> {
  const env = getServerEnv();
  if (env.POOL_GAP_FILL_SOURCE !== "goldsky") {
    return { events: null, reason: "off" };
  }
  if (
    (env.GOLDSKY_PIPELINE_START_LEDGER ?? Number.POSITIVE_INFINITY) >
    watermark + 1
  ) {
    return { events: null, reason: "archive_starts_late" };
  }
  const state = await (await getIndexerState()).findOne({ _id: "goldsky" });
  // A rejected row or a correction means a heartbeat may have advanced past
  // an event the archive does not hold; never vouch until an operator clears it.
  if ((state?.rejectedRows ?? 0) > 0 || state?.correctionAt) {
    return { events: null, reason: "archive_untrusted" };
  }
  if ((state?.lastLedger ?? 0) < scannedFromLedger + GOLDSKY_HEARTBEAT_MARGIN) {
    return { events: null, reason: "archive_behind" };
  }
  const rows = await (await getRawPoolEvents())
    .find({ ledger: { $gt: watermark, $lt: scannedFromLedger } })
    .sort({ ledger: 1, _id: 1 })
    .toArray();
  if (rows.some((row) => row.correctedAt)) {
    return { events: null, reason: "corrected_rows" };
  }
  // Only the decode step is guarded: the webhook stores rows verbatim, so a
  // malformed one must refuse the fill instead of wedging every later sync.
  // Mongo errors above stay thrown; they are transient and the next run retries.
  // A pool event that decodes but that its mirror parser rejects would be
  // dropped by the indexer while the fill still vouches for its ledger, so it
  // refuses too. Other topics (admin calls) are not mirrored and pass.
  const events: PoolEvent[] = [];
  for (const row of rows) {
    let kind: string | null = null;
    try {
      const event = rawRowToEvent(row);
      kind = eventKind(event);
      const parse =
        kind !== null && Object.hasOwn(MIRRORED_PARSERS, kind)
          ? MIRRORED_PARSERS[kind]
          : undefined;
      if (parse && parse(event) === null) {
        throw new Error("the mirror parser rejects its payload");
      }
      events.push(event);
    } catch (error) {
      console.warn(
        `[goldsky] gap fill refused: row ${row._id} (kind ${kind ?? "unknown"}) is undecodable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { events: null, reason: "archive_undecodable" };
    }
  }
  return {
    events,
    fromLedger: watermark + 1,
    toLedger: scannedFromLedger - 1,
  };
}
