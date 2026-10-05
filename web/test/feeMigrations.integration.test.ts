// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
const databaseNames: string[] = [];
let client: MongoClient;

async function migration() {
  // The production migration is intentionally plain ESM for migrate-mongo.
  // @ts-expect-error no declaration file is emitted for JavaScript migrations
  return import(
    "../migrations/20260904090000-client-fee-policies-and-relays.js"
  );
}

suite("fee migrations against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri as string).connect();
  });

  afterAll(async () => {
    if (!client) return;
    for (const name of databaseNames) await client.db(name).dropDatabase();
    await client.close();
  });

  it("is idempotent and creates every named index", async () => {
    const name = `olio_fee_certification_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    const { up } = await migration();
    await up(db);
    await up(db);

    const expected: Record<string, string[]> = {
      pool_fees: ["fee_quote_id"],
      client_fee_policies: ["active_effective_policy", "policy_audit_order"],
      cctp_relays: ["relay_state_lease", "relay_quote_id"],
      async_fee_quote_contexts: ["async_quote_expiry"],
      moneygram_quote_renewals: ["moneygram_settlement_operation"],
    };
    for (const [collectionName, required] of Object.entries(expected)) {
      const names = new Set(
        (await db.collection(collectionName).listIndexes().toArray()).map(
          (index) => index.name,
        ),
      );
      for (const indexName of required) expect(names.has(indexName)).toBe(true);
    }
  });

  it("refuses duplicate legacy identifiers before unique-index creation", async () => {
    const name = `olio_fee_duplicates_${randomUUID().replaceAll("-", "")}`;
    databaseNames.push(name);
    const db = client.db(name);
    await db
      .collection("pool_fees")
      .insertMany([{ quoteId: "duplicate" }, { quoteId: "duplicate" }]);
    const { up } = await migration();
    await expect(up(db)).rejects.toThrow("Duplicate legacy");
    const names = await db.collection("pool_fees").indexExists("fee_quote_id");
    expect(names).toBe(false);
  });
});
