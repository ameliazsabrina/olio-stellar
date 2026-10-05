// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("../src/server/db/mongo", async importOriginal => ({ ...await importOriginal<typeof import("../src/server/db/mongo")>(), getDb: async () => mocks.db! }));
import { claimLock, coordination, digest, seal, sharedBudget, unseal } from "../src/server/modules/cctp/cctp.storage";
import { unseal as operatorUnseal } from "../scripts/cctp-sessions.mjs";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
let client: MongoClient;

suite("CCTP coordination storage against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri!, { serverSelectionTimeoutMS: 3000 }).connect();
    mocks.db = client.db(`olio_cctp_storage_test_${randomUUID().replaceAll("-", "")}`);
  });
  afterAll(async () => { if (mocks.db) await mocks.db.dropDatabase(); await client?.close(); });
  beforeEach(async () => { await mocks.db!.collection("cctp_coordination").deleteMany({}); vi.stubEnv("CCTP_SESSION_KEY", "cd".repeat(32)); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it("binds sealed context to its session id and key", () => {
    const sealed = seal({ salt: "secret", nested: { n: 1 } }, "session-a");
    expect(unseal(sealed, "session-a")).toEqual({ salt: "secret", nested: { n: 1 } });
    expect(() => unseal(sealed, "session-b")).toThrow();
    expect(operatorUnseal(sealed, "session-a", "cd".repeat(32))).toEqual({ salt: "secret", nested: { n: 1 } });
    expect(() => operatorUnseal(sealed, "session-a", "ab".repeat(32))).toThrow();
    vi.stubEnv("CCTP_SESSION_KEY", "ab".repeat(32));
    expect(() => unseal(sealed, "session-a")).toThrow();
    expect(seal({ a: 1 }, "x")).not.toBe(seal({ a: 1 }, "x"));
  });

  it("refuses to seal without a configured key", () => {
    vi.stubEnv("CCTP_SESSION_KEY", "");
    expect(() => seal({ a: 1 }, "x")).toThrow(expect.objectContaining({ code: "configuration" }));
  });

  it("grants a contended lock to exactly one claimant", async () => {
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimLock("race", 30_000)));
    const holders = claims.filter(Boolean);
    expect(holders).toHaveLength(1);
    await holders[0]!.release();
    expect(await claimLock("race", 30_000)).not.toBeNull();
  });

  it("only the owner can heartbeat or release, and an expired lock is reclaimable", async () => {
    const first = (await claimLock("owned", 1000))!;
    expect(first).not.toBeNull();
    await first.heartbeat();
    await mocks.db!.collection<{ _id: string; until: Date }>("cctp_coordination").updateOne({ _id: "owned" }, { $set: { until: new Date(0) } });
    const second = (await claimLock("owned", 30_000))!;
    expect(second).not.toBeNull();
    await expect(first.heartbeat()).rejects.toMatchObject({ code: "lease_lost" });
    await expect(first.assert()).rejects.toMatchObject({ code: "lease_lost" });
    await first.release();
    await expect(second.assert()).resolves.toBeUndefined();
    await expect(second.assert(40_000)).rejects.toMatchObject({ code: "lease_lost" });
    await second.release();
    expect(await (await coordination()).findOne({ _id: "owned" })).toBeNull();
  });

  it("enforces a shared fixed-window budget that resets in the next window", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-11T10:00:00Z") });
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => sharedBudget("iris-test", 3, 1000)));
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.find(o => o.status === "rejected")).toMatchObject({ reason: { code: "throttled", retryAfterMs: 1000 } });
    vi.setSystemTime(new Date("2026-09-11T10:00:01.500Z"));
    await expect(sharedBudget("iris-test", 3, 1000)).resolves.toBeUndefined();
    const rows = await (await coordination()).find({ _id: { $regex: /^budget:iris-test:/ } }).toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.expiresAt instanceof Date)).toBe(true);
  });

  it("digests deterministically", () => {
    expect(digest("a")).toBe(digest("a"));
    expect(digest("a")).not.toBe(digest("b"));
    expect(digest("a")).toHaveLength(64);
  });
});
