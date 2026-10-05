// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: null as Db | null, route: vi.fn(), rpc: vi.fn(), relay: vi.fn(), iris: vi.fn() }));
vi.mock("../src/server/db/mongo", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/server/db/mongo")>();
  return { ...actual, getDb: async () => mocks.db!, getCctpSessions: async () => mocks.db!.collection("cctp_sessions"), getCctpRelays: async () => mocks.db!.collection("cctp_relays"), getAsyncFeeQuoteContexts: async () => mocks.db!.collection("async_fee_quote_contexts") };
});
vi.mock("../src/lib/stellar", async () => {
  const { StrKey } = await import("@stellar/stellar-sdk");
  return { poolId: StrKey.encodeContract(Buffer.alloc(32, 9)), networkPassphrase: "Test SDF Network ; September 2015", resolveUsernameOnChain: async () => ({ owner: StrKey.encodeContract(Buffer.alloc(32, 6)) }) };
});
vi.mock("../src/lib/cctp", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/lib/cctp")>();
  const { StrKey } = await import("@stellar/stellar-sdk");
  return { ...actual, cctpIntakeContract: StrKey.encodeContract(Buffer.alloc(32, 8)) };
});
vi.mock("../src/env", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/env")>();
  const { StrKey } = await import("@stellar/stellar-sdk");
  return { ...actual, env: { ...actual.env, NEXT_PUBLIC_OLIO_POOL_ID: StrKey.encodeContract(Buffer.alloc(32, 9)) } };
});
vi.mock("../src/server/modules/cctp/cctp.readiness", () => ({ assertRouteReady: mocks.route }));
vi.mock("../src/server/modules/feeQuotes/feeQuotes.readiness", () => ({ assertPaymentIngressReady: async () => {} }));
vi.mock("../src/server/modules/cctp/cctp.rpc", () => ({ sourceRpc: mocks.rpc }));
vi.mock("../src/server/modules/cctp/cctp.service", () => ({ relayDeposit: mocks.relay }));
vi.mock("../src/server/modules/cctp/iris.client", async importOriginal => ({ ...await importOriginal<typeof import("../src/server/modules/cctp/iris.client")>(), fetchIrisMessages: mocks.iris }));
import { cctpFixture, fixtureOwner, fixturePool, fixtureSigner } from "./helpers/cctpFixture";
import { bytesToHex, toBE32 } from "../src/lib/crypto";
import { createSession, recordSubmission, sessionContext } from "../src/server/modules/cctp/cctp.sessions";
import { seal } from "../src/server/modules/cctp/cctp.storage";
import { ATTENTION_AFTER_MS, MAX_BACKOFF_MS, runCctpWorker, settleNextSession, WORKER_HEARTBEAT_MS } from "../src/server/modules/cctp/cctp.worker";
import { cctpHealth } from "../src/server/modules/cctp/cctp.health";
import type { CreateSessionInput } from "../src/server/modules/cctp/cctp.schema";
import type { CctpSessionDoc } from "../src/server/db/mongo";
import { requeueUpdate } from "../scripts/cctp-sessions.mjs";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
let client: MongoClient;
let fixture: Awaited<ReturnType<typeof cctpFixture>>;
let input: CreateSessionInput;
const sessions = () => mocks.db!.collection<CctpSessionDoc>("cctp_sessions");
const coordination = () => mocks.db!.collection<{ _id: string; until?: Date }>("cctp_coordination");
const relayResult = { leafIndex: 7, paymentAmount: "100", feeAmount: "2", totalAmount: "102", feePolicyVersion: 2, txHash: "de".repeat(32) };
async function submittedSession() {
  const accepted = await createSession(input);
  await recordSubmission({ sessionId: accepted.sessionId, capability: input.capability, sourceTxHash: fixture.hash });
  return accepted.sessionId;
}

suite("CCTP settlement worker against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri!, { serverSelectionTimeoutMS: 3000 }).connect();
    mocks.db = client.db(`olio_cctp_worker_test_${randomUUID().replaceAll("-", "")}`);
    // @ts-expect-error plain ESM production migration
    const migration = await import("../migrations/20260910090000-cctp-sessions.js");
    await migration.up(mocks.db);
  });
  afterAll(async () => { if (mocks.db) await mocks.db.dropDatabase(); await client?.close(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    for (const name of ["cctp_sessions", "cctp_relays", "async_fee_quote_contexts", "cctp_coordination"]) await mocks.db!.collection(name).deleteMany({});
    vi.clearAllMocks();
    vi.stubEnv("CCTP_SESSION_KEY", "cd".repeat(32));
    vi.stubEnv("CCTP_WORKER_ENABLED", "true");
    vi.stubEnv("FEE_QUOTE_SIGNING_SECRET", fixtureSigner.secret());
    mocks.route.mockResolvedValue(undefined); mocks.rpc.mockResolvedValue("0x100");
    fixture = await cctpFixture();
    input = { username: "alice", feeQuote: fixture.envelope, salt: fixture.salt, capability: "ef".repeat(32) };
    await mocks.db!.collection<{ _id: string } & Record<string, unknown>>("async_fee_quote_contexts").insertOne({ _id: fixture.envelope.quote.quoteId, owner: fixtureOwner, commitment: fixture.envelope.quote.commitment, notePubkey: bytesToHex(toBE32(11n)), viewPubkey: bytesToHex(toBE32(12n)) });
    mocks.iris.mockResolvedValue([{ status: "complete", message: fixture.message, attestation: "0xaabb" }]);
    mocks.relay.mockResolvedValue(relayResult);
  });

  it("writes a worker heartbeat the route gate can observe, even when idle", async () => {
    const run = await runCctpWorker();
    expect(run).toMatchObject({ status: "idle", processed: 0 });
    const heartbeat = await coordination().findOne({ _id: `worker:${fixturePool}` });
    expect(heartbeat?.until?.getTime()).toBeGreaterThan(Date.now() + WORKER_HEARTBEAT_MS - 5000);
    expect((await cctpHealth()).worker.alive).toBe(true);
  });

  it("lets concurrent claimants settle a session exactly once", async () => {
    await submittedSession();
    const results = await Promise.all(Array.from({ length: 4 }, () => settleNextSession()));
    expect(results.filter(r => r.status === "completed")).toHaveLength(1);
    expect(results.filter(r => r.status === "idle")).toHaveLength(3);
    expect(mocks.relay).toHaveBeenCalledTimes(1);
    const stored = await sessions().findOne({});
    expect(stored?.stage).toBe("completed");
    expect(stored?.leaseOwner).toBeUndefined();
  });

  it("aborts a checkpoint after the lease is stolen and leaves the thief's lease intact", async () => {
    const id = await submittedSession();
    mocks.relay.mockImplementationOnce(async () => {
      await sessions().updateOne({ _id: id }, { $set: { leaseOwner: "thief", leaseUntil: new Date(Date.now() + 600_000) } });
      return relayResult;
    });
    const outcome = await settleNextSession();
    expect(outcome).toMatchObject({ status: "pending", errorCode: "lease_lost" });
    const stored = await sessions().findOne({ _id: id });
    expect(stored?.stage).not.toBe("completed");
    expect(stored?.leaseOwner).toBe("thief");
    expect(stored?.result).toBeUndefined();
  });

  it("short-circuits on a durable relay deposit without consulting the provider", async () => {
    const id = await submittedSession();
    await mocks.db!.collection("cctp_relays").insertOne({ quoteId: input.feeQuote.quote.quoteId, state: "deposited", depositTxHash: "de".repeat(32), leafIndex: 7, paymentAmount: "1000000000", feeAmount: "20000000", totalAmount: "1020000000", policyVersion: 2 });
    mocks.iris.mockRejectedValue(new Error("Iris down"));
    expect((await settleNextSession()).status).toBe("completed");
    expect(mocks.iris).not.toHaveBeenCalled();
    expect(mocks.relay).not.toHaveBeenCalled();
    expect((await sessions().findOne({ _id: id }))?.result?.txHash).toBe("de".repeat(32));
  });

  it("never schedules a retry beyond the backoff ceiling plus jitter", async () => {
    const id = await submittedSession();
    await sessions().updateOne({ _id: id }, { $set: { attempts: 40 } });
    mocks.iris.mockRejectedValue(new Error("upstream down"));
    const before = Date.now();
    expect((await settleNextSession()).status).toBe("pending");
    const stored = await sessions().findOne({ _id: id });
    const delay = stored!.nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(MAX_BACKOFF_MS * 0.8 - 50);
    expect(delay).toBeLessThanOrEqual(MAX_BACKOFF_MS * 1.2 + 1000);
    expect(stored?.stage).not.toBe("needs_attention");
  });

  it("parks a binding conflict and stops claiming it until an operator requeues it", async () => {
    const id = await submittedSession();
    mocks.iris.mockResolvedValue([{ status: "complete", message: fixture.message, attestation: "0xaabb" }, { status: "complete", message: fixture.message, attestation: "0xccdd" }]);
    expect(await settleNextSession()).toMatchObject({ status: "pending", errorCode: "binding" });
    let stored = await sessions().findOne({ _id: id });
    expect(stored?.stage).toBe("needs_attention");
    await sessions().updateOne({ _id: id }, { $set: { nextAttemptAt: new Date(0) } });
    expect((await runCctpWorker()).status).toBe("idle");
    expect((await cctpHealth()).sessions.needsAttention).toBe(1);
    mocks.iris.mockResolvedValue([{ status: "complete", message: fixture.message, attestation: "0xaabb" }]);
    await sessions().updateOne({ _id: id }, requeueUpdate(stored!) as never);
    stored = await sessions().findOne({ _id: id });
    expect(stored).toMatchObject({ stage: "source_submitted", attempts: 0 });
    expect(stored?.requeuedAt).toBeInstanceOf(Date);
    expect((await runCctpWorker()).status).toBe("completed");
  });

  it("escalates a session pending for over a day, measured from its last requeue", async () => {
    const id = await submittedSession();
    mocks.iris.mockRejectedValue(new Error("still pending"));
    const created = new Date(Date.now() - ATTENTION_AFTER_MS - 60_000);
    await sessions().updateOne({ _id: id }, { $set: { createdAt: created, requeuedAt: new Date() } });
    expect((await settleNextSession()).status).toBe("pending");
    expect((await sessions().findOne({ _id: id }))?.stage).not.toBe("needs_attention");
    await sessions().updateOne({ _id: id }, { $set: { nextAttemptAt: new Date(0) }, $unset: { requeuedAt: "" } });
    expect((await settleNextSession()).status).toBe("pending");
    expect((await sessions().findOne({ _id: id }))?.stage).toBe("needs_attention");
  });

  it("drains several due sessions in one invocation and stops when the queue is idle", async () => {
    const id = await submittedSession();
    const original = (await sessions().findOne({ _id: id }))!;
    const secondId = "ab".repeat(32);
    await sessions().insertOne({ ...original, _id: secondId, quoteId: "cd".repeat(32), encryptedContext: seal(sessionContext(original), secondId) });
    await mocks.db!.collection("cctp_relays").insertOne({ quoteId: "cd".repeat(32), state: "deposited", depositTxHash: "ef".repeat(32), leafIndex: 8, paymentAmount: "1000000000", feeAmount: "20000000", totalAmount: "1020000000", policyVersion: 2 });
    const run = await runCctpWorker();
    expect(run).toMatchObject({ processed: 2, completed: 2, status: "completed", exhausted: false });
    expect(await sessions().countDocuments({ stage: "completed" })).toBe(2);
  });
});
