import { Binary, Collection, Db, MongoClient } from "mongodb";

export type DepositDoc = {
  _id: number; // leafIndex — positional Merkle leaf index, must stay contiguous
  commitment: Binary;
  ephemeralPk: Binary;
  ciphertext: Binary;
  ledger: number;
  txHash: string;
  ts: Date;
};

export type UsernameDoc = {
  _id: string; // lowercased username
  owner: string;
  notePubkey: Binary;
  viewPubkey: Binary;
  createdLedger: number; // ledger this cache entry was (re)written at, not registration ledger
  createdAt: Date;
  updatedAt?: Date;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
};

export type IndexerStateDoc = {
  _id: "pool" | "registry";
  lastLedger: number;
  lastLeafIndex?: number;
  updatedAt: Date;
};

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/olio";

declare global {
  // eslint-disable-next-line no-var
  var _olioMongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // Reuse the connection across HMR reloads in dev.
  if (!global._olioMongoClientPromise) {
    global._olioMongoClientPromise = new MongoClient(uri).connect();
  }
  clientPromise = global._olioMongoClientPromise;
} else {
  clientPromise = new MongoClient(uri).connect();
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(); // resolves db name from the URI path (`olio`)
}

export async function getDeposits(): Promise<Collection<DepositDoc>> {
  return (await getDb()).collection<DepositDoc>("deposits");
}

export async function getUsernames(): Promise<Collection<UsernameDoc>> {
  return (await getDb()).collection<UsernameDoc>("usernames");
}

export async function getIndexerState(): Promise<Collection<IndexerStateDoc>> {
  return (await getDb()).collection<IndexerStateDoc>("indexer_state");
}
