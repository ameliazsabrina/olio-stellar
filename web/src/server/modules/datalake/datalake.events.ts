import "server-only";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { AnyBulkWriteOperation } from "mongodb";
import { getServerEnv } from "../../../env.server";
import {
  networkPassphrase,
  type PoolEvent,
  parseDepositEvent,
  parseFeeEvent,
  parseSpentEvent,
  parseWithdrawEvent,
  poolId,
  stellarNetwork,
} from "../../../lib/stellar";
import {
  getIndexerState,
  getRawPoolEvents,
  type RawPoolEventDoc,
  type ScannedRange,
} from "../../db/mongo";
import {
  type ArchivedPoolEvent,
  type DataLakeConfig,
  type LedgerScan,
  ledgerObjectKey,
  scanLedger,
} from "./datalake.ledgers";

const AWS_BUCKET = "https://aws-public-blockchain.s3.us-east-2.amazonaws.com";
const AWS_LEDGERS_PREFIX = "v1.1/stellar/ledgers";

const CHUNK_LEDGERS = 256;
const CONCURRENCY = 32;
const FETCH_TIMEOUT_MS = 8_000;

export type GapFillReason =
  | "off"
  | "scanning"
  | "datalake_unavailable"
  | "datalake_mismatch"
  | "ledger_missing"
  | "ledger_undecodable"
  | "ledger_chain_broken"
  | "event_undecodable";

export type GapFill =
  | { events: PoolEvent[]; fromLedger: number; toLedger: number }
  | { events: null; reason: GapFillReason };

class Refusal extends Error {
  constructor(
    readonly reason: GapFillReason,
    message: string,
  ) {
    super(message);
  }
}

type DataLake = { baseUrl: string; batchesPerPartition: number };

type Fetched = { status: number; body: Buffer };

async function get(url: string): Promise<Fetched> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    } catch (error) {
      if (attempt >= 1) {
        throw new Refusal(
          "datalake_unavailable",
          `${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

const ok = (res: Fetched) => res.status >= 200 && res.status < 300;

async function candidateRoots(): Promise<string[]> {
  const prefix = `${AWS_LEDGERS_PREFIX}/${stellarNetwork === "mainnet" ? "pubnet" : "testnet"}`;
  const res = await get(
    `${AWS_BUCKET}/?list-type=2&delimiter=/&prefix=${encodeURIComponent(`${prefix}/`)}`,
  );
  if (!ok(res)) {
    throw new Refusal(
      "datalake_unavailable",
      `listing ${prefix}: HTTP ${res.status}`,
    );
  }
  const dated = [
    ...res.body.toString("utf8").matchAll(/<Prefix>([^<]+)<\/Prefix>/g),
  ]
    .map(([, folder]) => folder.replace(/\/$/, ""))
    .filter((folder) => /\/\d{4}-\d{2}-\d{2}$/.test(folder))
    .sort()
    .reverse();
  return [prefix, ...dated].map((folder) => `${AWS_BUCKET}/${folder}`);
}

async function loadDataLake(): Promise<DataLake> {
  const override = getServerEnv().POOL_DATALAKE_URL?.replace(/\/$/, "");
  for (const baseUrl of override ? [override] : await candidateRoots()) {
    const res = await get(`${baseUrl}/.config.json`);
    if (res.status === 404 || res.status === 403) continue;
    if (!ok(res)) {
      throw new Refusal(
        "datalake_unavailable",
        `${baseUrl}/.config.json: HTTP ${res.status}`,
      );
    }
    let config: Partial<DataLakeConfig>;
    try {
      config = JSON.parse(res.body.toString("utf8"));
    } catch {
      throw new Refusal(
        "datalake_mismatch",
        `${baseUrl}/.config.json is not JSON`,
      );
    }
    if (
      config.networkPassphrase !== networkPassphrase ||
      config.compression !== "zstd" ||
      config.ledgersPerBatch !== 1 ||
      !Number.isInteger(config.batchesPerPartition) ||
      (config.batchesPerPartition ?? 0) < 1
    ) {
      throw new Refusal(
        "datalake_mismatch",
        `${baseUrl} is not a one-ledger-per-file zstd lake for this network`,
      );
    }
    return {
      baseUrl,
      batchesPerPartition: config.batchesPerPartition as number,
    };
  }
  throw new Refusal("datalake_mismatch", "no data lake config found");
}

let dataLake: Promise<DataLake> | null = null;
function resolveDataLake(): Promise<DataLake> {
  dataLake ??= loadDataLake().catch((error) => {
    dataLake = null;
    throw error;
  });
  return dataLake;
}

async function fetchLedger(
  lake: DataLake,
  ledger: number,
): Promise<LedgerScan> {
  const res = await get(
    `${lake.baseUrl}/${ledgerObjectKey(ledger, lake.batchesPerPartition)}`,
  );
  if (res.status === 404 || res.status === 403) {
    throw new Refusal(
      "ledger_missing",
      `ledger ${ledger} is not in the data lake`,
    );
  }
  if (!ok(res)) {
    throw new Refusal(
      "datalake_unavailable",
      `ledger ${ledger}: HTTP ${res.status}`,
    );
  }
  try {
    return scanLedger(res.body, ledger, poolId);
  } catch (error) {
    throw new Refusal(
      "ledger_undecodable",
      `ledger ${ledger}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function scanChunk(
  lake: DataLake,
  from: number,
  to: number,
): Promise<LedgerScan[]> {
  const scans: LedgerScan[] = new Array(to - from + 1);
  let next = from;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, to - from + 1) }, async () => {
      while (!failed && next <= to) {
        const ledger = next;
        next += 1;
        try {
          scans[ledger - from] = await fetchLedger(lake, ledger);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return scans;
}

export function addScannedRange(
  ranges: ScannedRange[],
  range: ScannedRange,
): ScannedRange[] {
  const merged: ScannedRange[] = [];
  for (const next of [...ranges, range].sort(
    (a, b) => a.fromLedger - b.fromLedger,
  )) {
    const last = merged.at(-1);
    if (
      last &&
      last.toLedger + 1 === next.fromLedger &&
      last.toHash === next.prevHash
    ) {
      last.toLedger = next.toLedger;
      last.toHash = next.toHash;
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

async function storeEvents(events: ArchivedPoolEvent[]): Promise<void> {
  if (!events.length) return;
  const now = new Date();
  const ops: AnyBulkWriteOperation<RawPoolEventDoc>[] = events.map((event) => ({
    updateOne: {
      filter: { _id: event.id },
      update: {
        $set: {
          ledger: event.ledger,
          txHash: event.txHash,
          ledgerClosedAt: event.ledgerClosedAt,
          topics: event.topics,
          value: event.value,
        },
        $setOnInsert: { scannedAt: now },
      },
      upsert: true,
    },
  }));
  await (await getRawPoolEvents()).bulkWrite(ops, { ordered: false });
}

async function scanGap(
  from: number,
  to: number,
  deadline: number,
): Promise<GapFillReason | null> {
  const states = await getIndexerState();
  let ranges = (await states.findOne({ _id: "datalake" }))?.scannedRanges ?? [];
  let cursor = from;
  let prevHash: string | null = null;
  let scanned = 0;
  try {
    while (cursor <= to) {
      const covering = ranges.find(
        (r) => r.fromLedger <= cursor && cursor <= r.toLedger,
      );
      if (covering) {
        if (prevHash !== null && covering.prevHash !== prevHash) {
          throw new Refusal(
            "ledger_chain_broken",
            `ledger ${cursor} does not link to ledger ${cursor - 1}`,
          );
        }
        prevHash = covering.toHash;
        cursor = covering.toLedger + 1;
        continue;
      }
      if (Date.now() >= deadline) return "scanning";
      const nextRange = Math.min(
        ...ranges.filter((r) => r.fromLedger > cursor).map((r) => r.fromLedger),
      );
      const end = Math.min(to, cursor + CHUNK_LEDGERS - 1, nextRange - 1);
      const scans = await scanChunk(await resolveDataLake(), cursor, end);
      const chunkPrev = scans[0].previousLedgerHash;
      for (const scan of scans) {
        if (prevHash !== null && scan.previousLedgerHash !== prevHash) {
          throw new Refusal(
            "ledger_chain_broken",
            `ledger ${scan.ledger} does not link to ledger ${scan.ledger - 1}`,
          );
        }
        prevHash = scan.hash;
      }
      await storeEvents(scans.flatMap((scan) => scan.events));
      ranges = addScannedRange(ranges, {
        fromLedger: cursor,
        toLedger: end,
        prevHash: chunkPrev,
        toHash: prevHash as string,
      });
      await states.updateOne(
        { _id: "datalake" },
        {
          $set: { scannedRanges: ranges, updatedAt: new Date() },
          $max: { lastLedger: end },
        },
        { upsert: true },
      );
      scanned += end - cursor + 1;
      cursor = end + 1;
    }
    return null;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.warn(
      `[datalake] gap fill refused (${error.reason}): ${error.message}`,
    );
    return error.reason;
  } finally {
    if (scanned) {
      console.info(
        `[datalake] scanned ${scanned} ledgers of ${from}-${to}; next ledger ${cursor}`,
      );
    }
  }
}

export function rawRowToEvent(doc: RawPoolEventDoc): PoolEvent {
  return {
    id: doc._id,
    ledger: doc.ledger,
    ledgerClosedAt: doc.ledgerClosedAt.toISOString(),
    txHash: doc.txHash,
    topic: doc.topics.map((topic) => xdr.ScVal.fromXDR(topic, "base64")),
    value: xdr.ScVal.fromXDR(doc.value, "base64"),
  };
}

const MIRRORED_PARSERS: Record<string, (event: PoolEvent) => unknown> = {
  deposit: parseDepositEvent,
  spend: parseSpentEvent,
  withdraw: parseWithdrawEvent,
  fee: parseFeeEvent,
};

function eventKind(event: PoolEvent): string | null {
  const topic = event.topic.at(0);
  return topic ? String(scValToNative(topic)) : null;
}

export async function fillRetentionGap(
  watermark: number,
  scannedFromLedger: number,
  deadline: number,
): Promise<GapFill> {
  if (getServerEnv().POOL_GAP_FILL_SOURCE !== "datalake") {
    return { events: null, reason: "off" };
  }
  const refusal = await scanGap(watermark + 1, scannedFromLedger - 1, deadline);
  if (refusal) return { events: null, reason: refusal };

  const rows = await (await getRawPoolEvents())
    .find({ ledger: { $gt: watermark, $lt: scannedFromLedger } })
    .sort({ ledger: 1, _id: 1 })
    .toArray();
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
        `[datalake] gap fill refused: event ${row._id} (kind ${kind ?? "unknown"}) is undecodable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { events: null, reason: "event_undecodable" };
    }
  }
  return {
    events,
    fromLedger: watermark + 1,
    toLedger: scannedFromLedger - 1,
  };
}
