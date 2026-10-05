// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const mocks = vi.hoisted(() => ({
  db: null as Db | null,
  submission: vi.fn(),
  route: vi.fn(),
  rpc: vi.fn(),
  relay: vi.fn(),
  iris: vi.fn(),
}));
vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireAccountSubmission: mocks.submission,
}));
vi.mock("../src/server/db/mongo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/db/mongo")>();
  return {
    ...actual,
    getDb: async () => mocks.db!,
    getCctpSessions: async () => mocks.db!.collection("cctp_sessions"),
    getCctpRelays: async () => mocks.db!.collection("cctp_relays"),
    getAsyncFeeQuoteContexts: async () =>
      mocks.db!.collection("async_fee_quote_contexts"),
  };
});
vi.mock("../src/lib/stellar", async () => {
  const { StrKey } = await import("@stellar/stellar-sdk");
  return {
    poolId: StrKey.encodeContract(Buffer.alloc(32, 9)),
    networkPassphrase: "Test SDF Network ; September 2015",
    resolveUsernameOnChain: async () => ({
      owner: StrKey.encodeContract(Buffer.alloc(32, 6)),
    }),
  };
});
vi.mock("../src/lib/cctp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/cctp")>();
  const { StrKey } = await import("@stellar/stellar-sdk");
  return {
    ...actual,
    cctpIntakeContract: StrKey.encodeContract(Buffer.alloc(32, 8)),
  };
});
vi.mock("../src/server/modules/cctp/cctp.readiness", () => ({
  assertRouteReady: mocks.route,
}));
vi.mock("../src/server/modules/feeQuotes/feeQuotes.readiness", () => ({
  assertPaymentIngressReady: async () => {},
}));
vi.mock("../src/server/modules/cctp/cctp.rpc", () => ({
  sourceRpc: mocks.rpc,
}));
vi.mock("../src/server/modules/cctp/cctp.service", () => ({
  relayDeposit: mocks.relay,
}));
vi.mock("../src/server/modules/cctp/iris.client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/server/modules/cctp/iris.client")
  >()),
  fetchIrisMessages: mocks.iris,
}));
import {
  cctpFixture,
  fixtureOwner,
  fixtureSigner,
} from "./helpers/cctpFixture";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { serializeFeeQuoteEnvelope, signFeeQuote } from "../src/lib/fee-quote";
import { bytesToHex, toBE32 } from "../src/lib/crypto";
import {
  createSession,
  authorizedSession,
  recordSubmission,
  resumeSession,
  sessionContext,
} from "../src/server/modules/cctp/cctp.sessions";
import {
  digest,
  seal,
  unseal,
  claimLock,
  sharedBudget,
} from "../src/server/modules/cctp/cctp.storage";
import { runCctpWorker } from "../src/server/modules/cctp/cctp.worker";
import type { CreateSessionInput } from "../src/server/modules/cctp/cctp.schema";
import type { CctpSessionDoc } from "../src/server/db/mongo";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
let client: MongoClient;
let fixture: Awaited<ReturnType<typeof cctpFixture>>;
let input: CreateSessionInput;
const sessions = () => mocks.db!.collection<CctpSessionDoc>("cctp_sessions");
suite("durable CCTP sessions and worker against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri!, {
      serverSelectionTimeoutMS: 3000,
    }).connect();
    mocks.db = client.db(`olio_cctp_test_${randomUUID().replaceAll("-", "")}`);
    // @ts-expect-error plain ESM production migration
    const migration = await import(
      "../migrations/20260910090000-cctp-sessions.js"
    );
    await migration.up(mocks.db);
  });
  afterAll(async () => {
    if (mocks.db) await mocks.db.dropDatabase();
    await client?.close();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    for (const name of [
      "cctp_sessions",
      "cctp_relays",
      "async_fee_quote_contexts",
      "cctp_coordination",
    ])
      await mocks.db!.collection(name).deleteMany({});
    vi.clearAllMocks();
    mocks.submission.mockResolvedValue(undefined);
    vi.stubEnv("CCTP_SESSION_KEY", "cd".repeat(32));
    vi.stubEnv("CCTP_WORKER_ENABLED", "true");
    vi.stubEnv("FEE_QUOTE_SIGNING_SECRET", fixtureSigner.secret());
    mocks.route.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue("0x100");
    fixture = await cctpFixture();
    input = {
      username: "alice",
      feeQuote: fixture.envelope,
      salt: fixture.salt,
      capability: "ef".repeat(32),
    };
    await mocks
      .db!.collection<{ _id: string } & Record<string, unknown>>(
        "async_fee_quote_contexts",
      )
      .insertOne({
        _id: fixture.envelope.quote.quoteId,
        owner: fixtureOwner,
        commitment: fixture.envelope.quote.commitment,
        notePubkey: bytesToHex(toBE32(11n)),
        viewPubkey: bytesToHex(toBE32(12n)),
      });
    mocks.iris.mockResolvedValue([
      { status: "complete", message: fixture.message, attestation: "0xaabb" },
    ]);
    mocks.relay.mockResolvedValue({
      leafIndex: 7,
      paymentAmount: "100",
      feeAmount: "2",
      totalAmount: "102",
      feePolicyVersion: 2,
      txHash: "de".repeat(32),
    });
  });
  it("blocks new sessions for an unsubmitted recipient but preserves accepted sessions and recovery", async () => {
    mocks.submission.mockRejectedValue(
      new Error("VERIFICATION_SUBMISSION_REQUIRED"),
    );
    await expect(createSession(input)).rejects.toThrow(
      "VERIFICATION_SUBMISSION_REQUIRED",
    );
    expect(await sessions().countDocuments()).toBe(0);
    mocks.submission.mockResolvedValue(undefined);
    const accepted = await createSession(input);
    mocks.submission.mockRejectedValue(
      new Error("VERIFICATION_SUBMISSION_REQUIRED"),
    );
    expect((await createSession(input)).sessionId).toBe(accepted.sessionId);
    await expect(
      recordSubmission({
        sessionId: accepted.sessionId,
        capability: input.capability,
        sourceTxHash: "0x" + "ab".repeat(32),
      }),
    ).resolves.toBeDefined();
  });
  it("makes concurrent quote acceptance idempotent; stores only hashed capability and encrypted recovery", async () => {
    const accepted = await Promise.all(
      Array.from({ length: 4 }, () => createSession(input)),
    );
    expect(new Set(accepted.map((s) => s.sessionId)).size).toBe(1);
    expect(await sessions().countDocuments()).toBe(1);
    const stored = await sessions().findOne({});
    expect(stored?.capabilityHash).toBe(digest(input.capability));
    expect(JSON.stringify(stored)).not.toContain(input.capability);
    expect(JSON.stringify(stored)).not.toContain(input.salt);
    expect(sessionContext(stored!).input).toEqual({
      username: input.username,
      salt: input.salt,
      feeQuote: input.feeQuote,
    });
    await expect(
      createSession({ ...input, capability: "ab".repeat(32) }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      authorizedSession({
        sessionId: accepted[0].sessionId,
        capability: "ab".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
  it.each([
    [
      "foreign signer",
      () => ({
        feeQuote: serializeFeeQuoteEnvelope({
          quote: fixture.quote,
          signature: signFeeQuote(
            fixture.quote,
            Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)),
          ),
        }),
      }),
    ],
    [
      "wrong channel",
      () => {
        const quote = { ...fixture.quote, channel: "direct" as const };
        return {
          feeQuote: serializeFeeQuoteEnvelope({
            quote,
            signature: signFeeQuote(quote, fixtureSigner),
          }),
        };
      },
    ],
    [
      "wrong pool",
      () => {
        const quote = {
          ...fixture.quote,
          pool: StrKey.encodeContract(Buffer.alloc(32, 1)),
        };
        return {
          feeQuote: serializeFeeQuoteEnvelope({
            quote,
            signature: signFeeQuote(quote, fixtureSigner),
          }),
        };
      },
    ],
    [
      "wrong depositor",
      () => {
        const quote = {
          ...fixture.quote,
          depositor: StrKey.encodeContract(Buffer.alloc(32, 2)),
        };
        return {
          feeQuote: serializeFeeQuoteEnvelope({
            quote,
            signature: signFeeQuote(quote, fixtureSigner),
          }),
        };
      },
    ],
    [
      "expired quote",
      () => {
        const quote = {
          ...fixture.quote,
          expiresAt: BigInt(Math.floor(Date.now() / 1000) - 1),
        };
        return {
          feeQuote: serializeFeeQuoteEnvelope({
            quote,
            signature: signFeeQuote(quote, fixtureSigner),
          }),
        };
      },
    ],
    [
      "fee arithmetic mismatch",
      () => {
        const quote = {
          ...fixture.quote,
          feeAmount: fixture.quote.feeAmount + 1n,
          totalAmount: fixture.quote.totalAmount + 1n,
        };
        return {
          feeQuote: serializeFeeQuoteEnvelope({
            quote,
            signature: signFeeQuote(quote, fixtureSigner),
          }),
        };
      },
    ],
    ["wrong salt for commitment", () => ({ salt: "ff".repeat(32) })],
  ])("rejects a session whose evidence fails binding: %s", async (_label, mutate) => {
    await expect(
      createSession({ ...input, ...mutate() }),
    ).rejects.toMatchObject({ code: "binding" });
    expect(await sessions().countDocuments()).toBe(0);
  });
  it("rejects a session when the recipient's issued context is missing or rotated", async () => {
    await mocks
      .db!.collection("async_fee_quote_contexts")
      .updateOne(
        { _id: fixture.envelope.quote.quoteId },
        { $set: { commitment: "00".repeat(32) } },
      );
    await expect(createSession(input)).rejects.toMatchObject({
      code: "binding",
    });
    await mocks.db!.collection("async_fee_quote_contexts").deleteMany({});
    await expect(createSession(input)).rejects.toMatchObject({
      code: "binding",
    });
    expect(await sessions().countDocuments()).toBe(0);
  });
  it("rejects quote/salt tampering before session insertion", async () => {
    await expect(
      createSession({ ...input, salt: "ff".repeat(32) }),
    ).rejects.toThrow();
    await expect(
      createSession({
        ...input,
        feeQuote: {
          ...input.feeQuote,
          quote: { ...input.feeQuote.quote, totalAmount: "1" },
        },
      }),
    ).rejects.toThrow();
    expect(await sessions().countDocuments()).toBe(0);
  });
  it("keeps unresolved context after the original quote context is removed, and fences capability to pool/network", async () => {
    const accepted = await createSession(input);
    await mocks.db!.collection("async_fee_quote_contexts").deleteMany({});
    const stored = await authorizedSession({
      sessionId: accepted.sessionId,
      capability: input.capability,
    });
    expect(sessionContext(stored).owner).toBe(fixtureOwner);
    const indexes = await sessions().listIndexes().toArray();
    expect(indexes.some((i) => "expireAfterSeconds" in i)).toBe(false);
    await sessions().updateOne(
      { _id: stored._id },
      { $set: { network: "other" } },
    );
    await expect(
      authorizedSession({
        sessionId: stored._id,
        capability: input.capability,
      }),
    ).rejects.toThrow();
  });
  it("binds a case-normalized source identifier once, never regresses completed status", async () => {
    const accepted = await createSession(input);
    const auth = {
      sessionId: accepted.sessionId,
      capability: input.capability,
    };
    const submitted = await recordSubmission({
      ...auth,
      sourceTxHash: fixture.hash.toUpperCase().replace("0X", "0x"),
    });
    expect(submitted.sourceTxHash).toBe(fixture.hash);
    await expect(
      recordSubmission({ ...auth, sourceTxHash: `0x${"cc".repeat(32)}` }),
    ).rejects.toMatchObject({ code: "binding" });
    await sessions().updateOne(
      { _id: accepted.sessionId },
      { $set: { stage: "completed" } },
    );
    expect((await recordSubmission(auth)).stage).toBe("completed");
  });
  it("settles after browser closure; simultaneous workers call the relay only once", async () => {
    const accepted = await createSession(input);
    await recordSubmission({
      sessionId: accepted.sessionId,
      capability: input.capability,
      sourceTxHash: fixture.hash,
    });
    const results = await Promise.all([runCctpWorker(), runCctpWorker()]);
    expect(results.map((r) => r.status).sort()).toEqual(["completed", "idle"]);
    expect(mocks.relay).toHaveBeenCalledTimes(1);
    expect((await sessions().findOne({}))?.stage).toBe("completed");
  });
  it("recovers a deposit recorded before worker death without another relay or provider request", async () => {
    const accepted = await createSession(input);
    const auth = {
      sessionId: accepted.sessionId,
      capability: input.capability,
    };
    await recordSubmission({ ...auth, sourceTxHash: fixture.hash });
    mocks.relay.mockImplementationOnce(async () => {
      await mocks
        .db!.collection("cctp_relays")
        .insertOne({
          quoteId: input.feeQuote.quote.quoteId,
          state: "deposited",
          depositTxHash: "de".repeat(32),
          leafIndex: 7,
          paymentAmount: "1000000000",
          feeAmount: "20000000",
          totalAmount: "1020000000",
          policyVersion: 2,
        });
      throw new Error("process died after durable deposit");
    });
    expect((await runCctpWorker()).status).toBe("pending");
    await sessions().updateOne(
      { _id: accepted.sessionId },
      { $set: { nextAttemptAt: new Date(0) } },
    );
    mocks.iris.mockRejectedValue(new Error("Iris down"));
    expect((await runCctpWorker()).status).toBe("completed");
    expect(mocks.relay).toHaveBeenCalledTimes(1);
    expect((await resumeSession(auth)).result?.totalAmount).toBe("102");
  });
  it("survives attestation outage, honors retry schedule and preserves source identity", async () => {
    const accepted = await createSession(input);
    const auth = {
      sessionId: accepted.sessionId,
      capability: input.capability,
    };
    await recordSubmission({ ...auth, sourceTxHash: fixture.hash });
    mocks.iris.mockRejectedValue(new Error("upstream down"));
    await runCctpWorker();
    const pending = await sessions().findOne({});
    await resumeSession(auth);
    expect((await sessions().findOne({}))?.nextAttemptAt).toEqual(
      pending?.nextAttemptAt,
    );
    expect((await runCctpWorker()).status).toBe("idle");
    expect(pending?.sourceTxHash).toBe(fixture.hash);
    expect(mocks.relay).not.toHaveBeenCalled();
  });
  it("uses unique message identity and no session TTL even after additive rollback", async () => {
    const accepted = await createSession(input);
    const row = await sessions().findOne({ _id: accepted.sessionId });
    await sessions().updateOne(
      { _id: row!._id },
      { $set: { sourceMessageId: "0:nonce" } },
    );
    await expect(
      sessions().insertOne({
        ...row!,
        _id: "ff".repeat(32),
        quoteId: "bb".repeat(32),
        sourceMessageId: "0:nonce",
      }),
    ).rejects.toMatchObject({ code: 11000 });
    // @ts-expect-error plain ESM production migration
    const migration = await import(
      "../migrations/20260910090000-cctp-sessions.js"
    );
    await migration.down(mocks.db);
    expect(await sessions().countDocuments()).toBe(1);
    expect(await sessions().indexExists("session_message")).toBe(true);
  });
  it("authenticates encrypted recovery against its session and rejects changed ciphertext", () => {
    const sealed = seal({ salt: "secret" }, "session-a");
    expect(unseal(sealed, "session-a")).toEqual({ salt: "secret" });
    expect(() => unseal(sealed, "session-b")).toThrow();
    const changed = Buffer.from(sealed, "base64");
    changed[30] ^= 1;
    expect(() => unseal(changed.toString("base64"), "session-a")).toThrow();
  });
  it("shares rate budgets and fences expired locks across callers", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => sharedBudget("test", 5, 60_000)),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(5);
    const first = await claimLock("operator:test", 60_000);
    expect(first).not.toBeNull();
    expect(await claimLock("operator:test", 60_000)).toBeNull();
    await mocks
      .db!.collection<{ _id: string; until: Date }>("cctp_coordination")
      .updateOne({ _id: "operator:test" }, { $set: { until: new Date(0) } });
    const second = await claimLock("operator:test", 60_000);
    expect(second).not.toBeNull();
    await expect(first!.assert()).rejects.toMatchObject({ code: "lease_lost" });
    await first!.release();
    await expect(second!.assert()).resolves.toBeUndefined();
  });
});
