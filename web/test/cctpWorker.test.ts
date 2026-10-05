// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ heartbeats: [] as Date[] }));
vi.mock("../src/lib/stellar", () => ({ poolId: "POOL", networkPassphrase: "Test SDF Network ; September 2015" }));
vi.mock("../src/server/db/mongo", () => ({ getCctpSessions: async () => { throw new Error("not used"); }, getCctpRelays: async () => { throw new Error("not used"); } }));
vi.mock("../src/server/modules/cctp/cctp.storage", () => ({
  coordination: async () => ({ updateOne: async (_filter: unknown, update: { $set: { until: Date } }) => { state.heartbeats.push(update.$set.until); } }),
}));
vi.mock("../src/server/modules/cctp/cctp.sessions", () => ({ sessionContext: () => { throw new Error("not used"); } }));
vi.mock("../src/server/modules/cctp/cctp.service", () => ({ relayDeposit: vi.fn() }));
vi.mock("../src/server/modules/cctp/iris.client", () => ({ fetchIrisMessages: vi.fn(), selectIrisMessage: vi.fn() }));
vi.mock("../src/server/modules/cctp/cctp.rpc", () => ({ sourceRpc: vi.fn() }));
import { CctpOperationalError } from "../src/server/modules/cctp/cctp.errors";
import { ATTENTION_AFTER_MS, MAX_BACKOFF_MS, PENDING_POLL_MS, PENDING_POLL_WINDOW_MS, WORKER_HEARTBEAT_MS, needsAttention, retryDelayMs, runCctpWorker, type SettlementOutcome } from "../src/server/modules/cctp/cctp.worker";

beforeEach(() => { state.heartbeats = []; vi.stubEnv("CCTP_WORKER_ENABLED", "true"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("retry schedule", () => {
  it("polls a young pending transfer at a flat cadence regardless of attempt count", () => {
    const pending = new CctpOperationalError("pending");
    expect(retryDelayMs(0, pending, 0, 0)).toBe(PENDING_POLL_MS * 0.8);
    expect(retryDelayMs(6, pending, 1, 0)).toBeCloseTo(PENDING_POLL_MS * 1.2, 6);
    expect(retryDelayMs(50, pending, 0.5, PENDING_POLL_WINDOW_MS - 1)).toBe(PENDING_POLL_MS);
  });
  it("doubles from five seconds and caps at the ceiling with bounded jitter once a pending transfer is stale", () => {
    const stale = PENDING_POLL_WINDOW_MS;
    expect(retryDelayMs(0, new CctpOperationalError("pending", 0), 0, stale)).toBe(4000);
    expect(retryDelayMs(1, new CctpOperationalError("pending", 0), 0, stale)).toBe(8000);
    expect(retryDelayMs(4, new CctpOperationalError("pending", 0), 0, stale)).toBe(80_000 * 0.8);
    expect(retryDelayMs(6, new CctpOperationalError("pending", 0), 1, stale)).toBeCloseTo(MAX_BACKOFF_MS * 1.2, 6);
    expect(retryDelayMs(50, new CctpOperationalError("pending", 0), 0, stale)).toBe(MAX_BACKOFF_MS * 0.8);
  });
  it("backs off real faults even on a young transfer", () => {
    expect(retryDelayMs(4, new CctpOperationalError("upstream", 0), 0, 0)).toBe(80_000 * 0.8);
  });
  it("never retries sooner than the provider asked or than a minute after an unknown fault", () => {
    expect(retryDelayMs(0, new CctpOperationalError("throttled", 600_000), 0)).toBe(600_000);
    expect(retryDelayMs(0, new Error("unexpected"), 0)).toBe(60_000);
  });
});

describe("attention escalation", () => {
  const created = new Date("2026-09-10T00:00:00Z");
  it("parks binding conflicts immediately", () => {
    expect(needsAttention({ createdAt: created }, "binding", created.getTime())).toBe(true);
  });
  it("parks sessions older than a day, measured from the last requeue", () => {
    const now = created.getTime() + ATTENTION_AFTER_MS + 1;
    expect(needsAttention({ createdAt: created }, "pending", now)).toBe(true);
    expect(needsAttention({ createdAt: created }, "pending", now - 2)).toBe(false);
    expect(needsAttention({ createdAt: created, requeuedAt: new Date(now - 1000) }, "pending", now)).toBe(false);
  });
});

describe("drain loop", () => {
  const outcomes = (...items: SettlementOutcome[]) => {
    const queue = [...items];
    return vi.fn(async () => queue.shift() ?? ({ status: "idle" } as const));
  };
  it("reports disabled without touching storage", async () => {
    vi.stubEnv("CCTP_WORKER_ENABLED", "false");
    expect((await runCctpWorker({ settle: outcomes() })).status).toBe("disabled");
    expect(state.heartbeats).toHaveLength(0);
  });
  it("keeps claiming until the queue is idle and refreshes the worker heartbeat between sessions", async () => {
    const settle = outcomes({ status: "completed", sessionId: "a" }, { status: "pending", sessionId: "b", errorCode: "pending" }, { status: "completed", sessionId: "c" });
    const run = await runCctpWorker({ settle });
    expect(run).toMatchObject({ status: "completed", processed: 3, completed: 2, pending: 1, exhausted: false });
    expect(settle).toHaveBeenCalledTimes(4);
    expect(state.heartbeats).toHaveLength(4);
    for (const until of state.heartbeats) expect(until.getTime() - Date.now()).toBeGreaterThan(WORKER_HEARTBEAT_MS - 5000);
  });
  it("stops at the time budget and reports exhaustion", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const settle = vi.fn(async () => { vi.advanceTimersByTime(100_000); return { status: "completed", sessionId: String(Math.random()) } as const; });
    const run = await runCctpWorker({ settle, budgetMs: 240_000 });
    expect(run).toMatchObject({ processed: 3, exhausted: true, status: "completed" });
    expect(settle).toHaveBeenCalledTimes(3);
  });
  it("does not spin on a session that keeps coming back pending", async () => {
    const settle = outcomes({ status: "pending", sessionId: "a", errorCode: "lease_lost" }, { status: "pending", sessionId: "a", errorCode: "lease_lost" }, { status: "pending", sessionId: "a", errorCode: "lease_lost" });
    const run = await runCctpWorker({ settle });
    expect(run).toMatchObject({ status: "pending", processed: 2, pending: 2 });
    expect(settle).toHaveBeenCalledTimes(2);
  });
  it("reports idle when nothing is due", async () => {
    const run = await runCctpWorker({ settle: outcomes() });
    expect(run).toMatchObject({ status: "idle", processed: 0 });
    expect(state.heartbeats).toHaveLength(1);
  });
});
