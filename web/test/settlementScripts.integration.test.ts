import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { Binary, type Db, MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { merkleProof, toBE32 } from "../src/lib/crypto";

const webRoot = path.resolve(import.meta.dirname, "..");
const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
const scope = "CPOOLTEST";
let client: MongoClient;
let db: Db;
let databaseName: string;
let envFile: string;

function run(script: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      path.join(webRoot, "scripts", script),
      `--env-file=${envFile}`,
      `--expected-database=${databaseName}`,
      ...args,
    ],
    { cwd: webRoot, encoding: "utf8", timeout: 120_000 },
  );
}

describe("deposit event id backfill parsing", () => {
  it("reads the leaf index from a deposit event", async () => {
    const { depositLeafIndex } = (await import(
      new URL("../scripts/backfill-deposit-event-ids.mjs", import.meta.url).href
    )) as { depositLeafIndex: (event: unknown) => number | null };
    const value = xdr.ScVal.scvVec([
      nativeToScVal(5, { type: "u32" }),
      xdr.ScVal.scvBytes(Buffer.alloc(32, 1)),
      xdr.ScVal.scvBytes(Buffer.alloc(32, 2)),
      xdr.ScVal.scvBytes(Buffer.alloc(72, 3)),
    ]);
    expect(
      depositLeafIndex({
        topic: [nativeToScVal("deposit", { type: "symbol" })],
        value,
      }),
    ).toBe(5);
    expect(
      depositLeafIndex({
        topic: [nativeToScVal("spend", { type: "symbol" })],
        value,
      }),
    ).toBeNull();
  });
});

suite("settlement backfill and reset scripts", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri as string, {
      serverSelectionTimeoutMS: 3000,
    }).connect();
    databaseName = `olio_scripts_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    db = client.db(databaseName);
    const base = new URL(uri as string);
    base.pathname = `/${databaseName}`;
    const directory = mkdtempSync(
      path.join(tmpdir(), "olio-settlement-scripts-"),
    );
    envFile = path.join(directory, "scripts.env");
    writeFileSync(
      envFile,
      [
        `MONGODB_URI=${base.toString()}`,
        `MONGO_POOL_STORAGE_SCOPE=${scope}`,
        `NEXT_PUBLIC_OLIO_POOL_ID=${scope}`,
        "NEXT_PUBLIC_POOL_DEPTH=5",
        "",
      ].join("\n"),
    );
  });

  afterAll(async () => {
    if (db) await db.dropDatabase();
    await client?.close();
  });

  beforeEach(async () => {
    for (const name of await db
      .listCollections({}, { nameOnly: true })
      .toArray())
      await db.collection(name.name).deleteMany({});
  });

  it("refuses to reset a pool that has settlements", async () => {
    await db.collection("settlements").insertOne({
      _id: `testnet:${scope}:0` as never,
      network: "testnet",
      poolId: scope,
    });
    const result = run("reset-pool-storage.mjs", []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("issued evidence");
  }, 60_000);

  it("rebuilds pool roots only when executed", async () => {
    const leaves = [5n, 6n, 7n];
    await db.collection(`deposits__${scope}`).insertMany(
      leaves.map((leaf, index) => ({
        _id: index as never,
        commitment: new Binary(Buffer.from(toBE32(leaf))),
        ledger: 10 + index,
        ts: new Date(),
      })),
    );
    const dry = run("backfill-pool-roots.mjs", []);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("Dry run only");
    expect(await db.collection(`pool_roots__${scope}`).countDocuments()).toBe(
      0,
    );

    const executed = run("backfill-pool-roots.mjs", ["--execute"]);
    expect(executed.status).toBe(0);
    expect(await db.collection(`pool_roots__${scope}`).countDocuments()).toBe(
      3,
    );
    const expected = (await merkleProof(leaves, 0, 5)).root;
    expect(
      (await db.collection(`pool_roots__${scope}`).findOne({ _id: 3 as never }))
        ?.root,
    ).toBe(expected.toString(16).padStart(64, "0"));
    expect(
      await db
        .collection(`indexer_state__${scope}`)
        .findOne({ _id: "pool" as never }),
    ).toMatchObject({ rootLeafCount: 3 });
  }, 120_000);

  it("reports attribution gaps on a dry run and fills them when executed", async () => {
    await db.collection(`async_fee_quote_contexts__${scope}`).insertOne({
      _id: "9a".repeat(32) as never,
      channel: "cctp",
      owner: "CACME",
      commitment: "9b".repeat(32),
      notePubkey: "9c".repeat(32),
      viewPubkey: "9d".repeat(32),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    await db.collection(`indexer_state__${scope}`).insertOne({
      _id: "settlements" as never,
      lastLeafIndex: 40,
    });
    const dry = run("backfill-settlements.mjs", []);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('"copied": 1');
    expect(await db.collection("quote_contexts").countDocuments()).toBe(0);

    const executed = run("backfill-settlements.mjs", ["--execute"]);
    expect(executed.status).toBe(0);
    expect(await db.collection("quote_contexts").countDocuments()).toBe(1);
    expect(
      await db
        .collection(`indexer_state__${scope}`)
        .findOne({ _id: "settlements" as never }),
    ).toMatchObject({ lastLeafIndex: -1 });
  }, 120_000);
});
