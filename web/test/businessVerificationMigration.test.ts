// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
const databaseNames: string[] = [];
let client: MongoClient;

async function migration() {
  // @ts-expect-error plain ESM production migration
  return import("../migrations/20260921090000-business-verification.js");
}

const EXPECTED_INDEXES: Record<string, string[]> = {
  business_profiles: [
    "business_public_id",
    "business_username",
    "business_created_by",
  ],
  business_memberships: ["membership_business_user", "membership_user"],
  verification_cases: [
    "case_external_user",
    "case_applicant",
    "case_business_environment",
    "case_reconcile_due",
  ],
  verification_events: ["event_due", "event_external_user"],
  verification_audit: ["audit_business_time", "audit_case_time"],
  identity_credentials: [
    "credential_business_environment",
    "credential_publication",
  ],
  verification_coordination: ["verification_coordination_expiry"],
  payment_links: ["payment_link_business"],
};

async function indexNames(db: ReturnType<MongoClient["db"]>, name: string) {
  return new Set(
    (await db.collection(name).listIndexes().toArray()).map(
      (index) => index.name,
    ),
  );
}

suite("business verification migration against isolated MongoDB", () => {
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

  it("creates every named index and re-applies cleanly", async () => {
    const name = `olio_verification_migration_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    const { up } = await migration();
    await up(db);
    await up(db);
    for (const [collection, required] of Object.entries(EXPECTED_INDEXES)) {
      const names = await indexNames(db, collection);
      for (const index of required)
        expect([collection, index, names.has(index)]).toEqual([
          collection,
          index,
          true,
        ]);
    }
  });

  it("preserves existing payment links and adds only a partial business index", async () => {
    const name = `olio_verification_links_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    const legacy = {
      _id: "link_legacy",
      owner: "alice",
      slug: "tips",
      amount: null,
      label: null,
      status: "pending",
      createdAt: new Date(),
    };
    await db.collection("payment_links").insertOne(legacy);
    const { up } = await migration();
    await up(db);
    expect(
      await db.collection("payment_links").findOne({ _id: "link_legacy" }),
    ).toMatchObject({
      owner: "alice",
      slug: "tips",
    });
    const index = (
      await db.collection("payment_links").listIndexes().toArray()
    ).find((candidate) => candidate.name === "payment_link_business");
    expect(index?.partialFilterExpression).toEqual({
      businessId: { $type: "string" },
    });
    expect(index?.unique).toBeUndefined();
  });

  it("allows many unbound profiles but one profile per username", async () => {
    const name = `olio_verification_usernames_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    const { up } = await migration();
    await up(db);
    const profiles = db.collection("business_profiles");
    await profiles.insertOne({ _id: "b1", publicId: "p1", username: null });
    await profiles.insertOne({ _id: "b2", publicId: "p2", username: null });
    await profiles.insertOne({ _id: "b3", publicId: "p3", username: "alice" });
    await expect(
      profiles.insertOne({ _id: "b4", publicId: "p4", username: "alice" }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      profiles.insertOne({ _id: "b5", publicId: "p1", username: "bob" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("keeps one membership per business and user", async () => {
    const name = `olio_verification_members_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    const { up } = await migration();
    await up(db);
    const memberships = db.collection("business_memberships");
    await memberships.insertOne({
      _id: "m1",
      businessId: "b1",
      privyUserId: "u1",
      role: "owner",
    });
    await expect(
      memberships.insertOne({
        _id: "m2",
        businessId: "b1",
        privyUserId: "u1",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: 11000 });
    await memberships.insertOne({
      _id: "m3",
      businessId: "b2",
      privyUserId: "u1",
      role: "owner",
    });
  });

  it("expires coordination rows by TTL without touching audit history", async () => {
    const name = `olio_verification_ttl_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    const { up } = await migration();
    await up(db);
    const coordination = (
      await db.collection("verification_coordination").listIndexes().toArray()
    ).find((index) => index.name === "verification_coordination_expiry");
    expect(coordination?.expireAfterSeconds).toBe(0);
    const audit = await db
      .collection("verification_audit")
      .listIndexes()
      .toArray();
    expect(audit.some((index) => index.expireAfterSeconds !== undefined)).toBe(
      false,
    );
    const credentials = await db
      .collection("identity_credentials")
      .listIndexes()
      .toArray();
    expect(
      credentials.some((index) => index.expireAfterSeconds !== undefined),
    ).toBe(false);
  });
});
