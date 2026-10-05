// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requeueUpdate, run, sessionsCollectionName, summarize } from "../scripts/cctp-sessions.mjs";
import { seal } from "../src/server/modules/cctp/cctp.storage";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
let client: MongoClient;
let db: Db;
const key = "cd".repeat(32);
const id = "ab".repeat(32);
const now = new Date();
function session(overrides: Record<string, unknown> = {}) {
  process.env.CCTP_SESSION_KEY = key;
  return {
    _id: id, network: "n", pool: "p", quoteId: "q", capabilityHash: "cap", sourceDomain: 0, sourceTxHash: `0x${"11".repeat(32)}`,
    encryptedContext: seal({ input: { username: "alice", salt: "hidden", feeQuote: { quote: { quoteId: "q", sourceDomain: 0, paymentAmount: "100", feeAmount: "2", totalAmount: "102", expiresAt: "1" } } }, owner: "C_OWNER" }, id),
    stage: "needs_attention", errorCode: "binding", paymentAmount: "100", feeAmount: "2", totalAmount: "102", attempts: 9,
    nextAttemptAt: now, createdAt: new Date(now.getTime() - 120_000), updatedAt: now, leaseOwner: "stale", leaseUntil: new Date(now.getTime() - 1), ...overrides,
  };
}

describe("operator session tooling helpers", () => {
  it("scopes the collection name like the application", () => {
    expect(sessionsCollectionName(undefined)).toBe("cctp_sessions");
    expect(sessionsCollectionName("CPOOL")).toBe("cctp_sessions__CPOOL");
    expect(() => sessionsCollectionName("bad scope!")).toThrow();
  });
  it("summarizes without leaking sealed context or capability material", () => {
    const summary = summarize(session(), now.getTime());
    expect(summary).toMatchObject({ sessionId: id, stage: "needs_attention", errorCode: "binding", attempts: 9, ageMinutes: 2, leased: false });
    expect(JSON.stringify(summary)).not.toContain("hidden");
    expect(JSON.stringify(summary)).not.toContain("cap");
  });
  it("only requeues parked sessions and resets their retry window", () => {
    const update = requeueUpdate(session(), now);
    expect(update.$set).toMatchObject({ stage: "source_submitted", attempts: 0, nextAttemptAt: now, requeuedAt: now });
    expect(update.$unset).toEqual({ errorCode: "", leaseOwner: "", leaseUntil: "" });
    expect(requeueUpdate(session({ sourceTxHash: undefined }), now).$set.stage).toBe("submission_unknown");
    expect(() => requeueUpdate(session({ stage: "minting" }), now)).toThrow(/needs_attention/);
  });
});

suite("operator session tooling against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri!, { serverSelectionTimeoutMS: 3000 }).connect();
    db = client.db(`olio_cctp_ops_test_${randomUUID().replaceAll("-", "")}`);
  });
  afterAll(async () => { await db.dropDatabase(); await client.close(); });
  beforeEach(async () => {
    await db.collection("cctp_sessions").deleteMany({});
    await db.collection("cctp_coordination").deleteMany({});
    await db.collection("cctp_sessions").insertOne(session() as never);
  });
  const capture = () => { const lines: string[] = []; return { lines, out: (line: string) => lines.push(line) }; };

  it("lists parked sessions by default with stage counts", async () => {
    const { lines, out } = capture();
    expect(await run(["list"], db, { MONGO_POOL_STORAGE_SCOPE: undefined }, out)).toBe(0);
    const output = JSON.parse(lines[0]);
    expect(output.counts).toEqual({ needs_attention: 1 });
    expect(output.sessions[0].sessionId).toBe(id);
    expect(lines[0]).not.toContain("hidden");
  });

  it("inspects a session, revealing recovery context only on request and never the salt", async () => {
    const plain = capture();
    expect(await run(["inspect", id], db, {}, plain.out)).toBe(0);
    expect(plain.lines[0]).not.toContain("encryptedContext");
    expect(plain.lines[0]).not.toContain("capabilityHash");
    expect(plain.lines[0]).not.toContain("alice");
    const revealed = capture();
    expect(await run(["inspect", id, "--reveal"], db, { CCTP_SESSION_KEY: key }, revealed.out)).toBe(0);
    const detail = JSON.parse(revealed.lines[0]);
    expect(detail.context).toMatchObject({ username: "alice", owner: "C_OWNER", quote: { totalAmount: "102" } });
    expect(revealed.lines[0]).not.toContain("hidden");
    await expect(run(["inspect", id, "--reveal"], db, { CCTP_SESSION_KEY: "ab".repeat(32) }, revealed.out)).rejects.toThrow();
  });

  it("requeues a parked session atomically and refuses an unparked one", async () => {
    const { lines, out } = capture();
    expect(await run(["requeue", id], db, {}, out)).toBe(0);
    expect(JSON.parse(lines[0])).toMatchObject({ stage: "source_submitted", attempts: 0, errorCode: null, leased: false });
    await expect(run(["requeue", id], db, {}, out)).rejects.toThrow(/needs_attention/);
    await expect(run(["requeue", "ff".repeat(32)], db, {}, out)).rejects.toThrow(/not found/i);
  });

  it("shows and resets Iris circuit state", async () => {
    await db.collection("cctp_coordination").insertOne({ _id: "iris:circuit:0", failures: 4, denied: true, nextAt: new Date(Date.now() + 60_000) } as never);
    const shown = capture();
    expect(await run(["circuits"], db, {}, shown.out)).toBe(0);
    expect(JSON.parse(shown.lines[0])[0]).toMatchObject({ domain: 0, failures: 4, denied: true });
    expect(JSON.parse(shown.lines[0])[0].openUntil).not.toBeNull();
    expect(await run(["circuit-reset", "0"], db, {}, capture().out)).toBe(0);
    const row = await db.collection("cctp_coordination").findOne({ _id: "iris:circuit:0" } as never);
    expect(row).toMatchObject({ failures: 0, denied: false });
    expect((row as { nextAt: Date }).nextAt.getTime()).toBe(0);
  });

  it("prints usage for unknown commands", async () => {
    const { lines, out } = capture();
    expect(await run(["bogus"], db, {}, out)).toBe(2);
    expect(lines[0]).toContain("Usage");
  });
});
