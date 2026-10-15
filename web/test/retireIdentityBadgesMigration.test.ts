// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
const databaseNames: string[] = [];
let client: MongoClient;

async function verificationMigration() {
  // @ts-expect-error plain ESM production migration
  return import("../migrations/20260921090000-business-verification.js");
}

async function migration() {
  // @ts-expect-error plain ESM production migration
  return import("../migrations/20261016090000-retire-identity-badges.js");
}

function freshDb() {
  const name = `olio_retire_badges_${randomUUID().replaceAll("-", "")}`;
  databaseNames.push(name);
  return client.db(name);
}

async function indexNames(db: ReturnType<MongoClient["db"]>) {
  return (await db.collection("identity_credentials").listIndexes().toArray())
    .map((index) => index.name)
    .sort();
}

suite("retire identity badges migration against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri as string, {
      serverSelectionTimeoutMS: 3000,
    }).connect();
  });

  afterAll(async () => {
    if (!client) return;
    for (const name of databaseNames) await client.db(name).dropDatabase();
    await client.close();
  });

  it("unpublishes every credential and leaves the rest untouched", async () => {
    const db = freshDb();
    await (await verificationMigration()).up(db);
    const credentials = db.collection("identity_credentials");
    const publishedAt = new Date("2026-09-30T00:00:00.000Z");
    await credentials.insertMany([
      {
        _id: "cred_published",
        businessId: "b1",
        environment: "live",
        status: "active",
        published: true,
        publishedAt,
      },
      {
        _id: "cred_private",
        businessId: "b2",
        environment: "live",
        status: "suspended",
        published: false,
        publishedAt: null,
      },
    ]);

    const { up } = await migration();
    await up(db);
    await up(db);

    expect(await credentials.find().sort({ _id: 1 }).toArray()).toEqual([
      {
        _id: "cred_private",
        businessId: "b2",
        environment: "live",
        status: "suspended",
        published: false,
        publishedAt: null,
      },
      {
        _id: "cred_published",
        businessId: "b1",
        environment: "live",
        status: "active",
        published: false,
        publishedAt: null,
      },
    ]);
    expect(await credentials.countDocuments({ published: true })).toBe(0);
  });

  it("drops the publication index, keeps the business index, and rolls back", async () => {
    const db = freshDb();
    await (await verificationMigration()).up(db);
    const { up, down } = await migration();
    await up(db);
    expect(await indexNames(db)).toEqual([
      "_id_",
      "credential_business_environment",
    ]);
    await down(db);
    expect(await indexNames(db)).toEqual([
      "_id_",
      "credential_business_environment",
      "credential_publication",
    ]);
  });

  it("runs on a database without identity credentials", async () => {
    const db = freshDb();
    await expect((await migration()).up(db)).resolves.toBeUndefined();
  });
});
