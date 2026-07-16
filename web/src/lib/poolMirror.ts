import { api } from "../trpc/client";
import { hexToBytes } from "./crypto";
import { networkPassphrase, poolId, type DepositEvent } from "./stellar";

const DB_NAME = "olio-pool-mirror";
const STORE_NAME = "mirrors";
const DB_VERSION = 1;

export type PoolMirror = {
  scope: string;
  deposits: DepositEvent[];
  spentNullifiers: string[];
  publishedLedger: number;
  publishedLeafIndex: number;
  indexedAt: string;
  health: "healthy" | "stale" | "degraded";
  hydrated: boolean;
};

const memory = new Map<string, PoolMirror>();
const inFlight = new Map<string, Promise<PoolMirror>>();

function scopeKey(): string {
  return `${networkPassphrase}:${poolId}`;
}

function emptyMirror(): PoolMirror {
  return {
    scope: scopeKey(),
    deposits: [],
    spentNullifiers: [],
    publishedLedger: 0,
    publishedLeafIndex: -1,
    indexedAt: new Date(0).toISOString(),
    health: "degraded",
    hydrated: false,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "scope" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDb(scope: string): Promise<PoolMirror | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(scope);
      request.onsuccess = () =>
        resolve((request.result as PoolMirror | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeIndexedDb(mirror: PoolMirror): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(mirror);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadPoolMirror(): Promise<PoolMirror> {
  const scope = scopeKey();
  const cached = memory.get(scope);
  if (cached) return cached;
  try {
    const persisted = await readIndexedDb(scope);
    if (persisted) {
      const hydrated = { ...persisted, hydrated: true };
      memory.set(scope, hydrated);
      return hydrated;
    }
  } catch {
    // IndexedDB can be unavailable in private modes; use the session mirror.
  }
  const empty = emptyMirror();
  memory.set(scope, empty);
  return empty;
}

async function fetchAndMerge(): Promise<PoolMirror> {
  const current = await loadPoolMirror();
  const snapshot = await api.deposits.snapshot.query({
    afterLeafIndex: current.publishedLeafIndex,
    spentAfterLedger: current.publishedLedger,
  });
  const responseScope = `${snapshot.index.networkPassphrase}:${snapshot.index.poolId}`;
  const base = responseScope === current.scope ? current : emptyMirror();
  const deposits = new Map(base.deposits.map((row) => [row.leafIndex, row]));
  for (const row of snapshot.deposits) {
    deposits.set(row.leafIndex, {
      leafIndex: row.leafIndex,
      commitment: hexToBytes(row.commitmentHex),
      ephemeralPk: hexToBytes(row.ephemeralPkHex),
      ciphertext: hexToBytes(row.ciphertextHex),
    });
  }
  const spent = new Set(base.spentNullifiers);
  for (const row of snapshot.spentNullifiers) spent.add(row.nullifierHex);

  const merged: PoolMirror = {
    scope: responseScope,
    deposits: [...deposits.values()].sort((a, b) => a.leafIndex - b.leafIndex),
    spentNullifiers: [...spent],
    publishedLedger: snapshot.index.publishedLedger,
    publishedLeafIndex: snapshot.index.publishedLeafIndex,
    indexedAt: snapshot.index.indexedAt,
    health: snapshot.index.health,
    hydrated: true,
  };
  memory.set(responseScope, merged);
  try {
    await writeIndexedDb(merged);
  } catch {
    // The in-memory result remains valid for this session.
  }
  return merged;
}

export function refreshPoolMirror(): Promise<PoolMirror> {
  const scope = scopeKey();
  const pending = inFlight.get(scope);
  if (pending) return pending;
  const refresh = fetchAndMerge().finally(() => inFlight.delete(scope));
  inFlight.set(scope, refresh);
  return refresh;
}
