import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: "false",
  heartbeat: null as { until: Date } | null,
  needsAttention: 0,
  circuits: [] as { _id: string; failures?: number; denied?: boolean; nextAt?: Date }[],
}));

vi.mock("../src/env", () => ({ env: { NEXT_PUBLIC_OLIO_POOL_ID: "POOL" } }));
vi.mock("../src/env.server", () => ({
  getServerEnv: () => ({ CCTP_WORKER_ENABLED: mocks.enabled }),
}));
vi.mock("../src/server/modules/cctp/cctp.storage", () => ({
  coordination: async () => ({
    findOne: async () => mocks.heartbeat,
    find: () => ({ toArray: async () => mocks.circuits }),
  }),
}));
vi.mock("../src/server/db/mongo", () => ({
  getCctpSessions: async () => ({
    countDocuments: async (filter: { stage?: unknown }) =>
      filter.stage === "needs_attention" ? mocks.needsAttention : 0,
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  }),
}));

const { cctpHealth } = await import("../src/server/modules/cctp/cctp.health");
const { GET } = await import("../src/app/api/health/cctp/route");

const now = new Date("2026-10-05T12:00:00Z");

describe("cctp health", () => {
  beforeEach(() => {
    mocks.enabled = "false";
    mocks.heartbeat = null;
    mocks.needsAttention = 0;
    mocks.circuits = [];
  });

  it("reports a switched-off worker as disabled, not degraded", async () => {
    const health = await cctpHealth(now);
    expect(health.status).toBe("disabled");
    expect(health.worker).toEqual({ enabled: false, alive: false, until: null });
    expect((await GET()).status).toBe(200);
  });

  it("stays degraded while disabled if sessions need an operator", async () => {
    mocks.needsAttention = 1;
    expect((await cctpHealth(now)).status).toBe("degraded");
    expect((await GET()).status).toBe(503);
  });

  it("is degraded when enabled without a live worker", async () => {
    mocks.enabled = "true";
    expect((await cctpHealth(now)).status).toBe("degraded");
  });

  it("is ok when enabled with a live worker and no faults", async () => {
    mocks.enabled = "true";
    mocks.heartbeat = { until: new Date(now.getTime() + 60_000) };
    expect((await cctpHealth(now)).status).toBe("ok");
  });

  it("is degraded when enabled and a circuit is denied", async () => {
    mocks.enabled = "true";
    mocks.heartbeat = { until: new Date(now.getTime() + 60_000) };
    mocks.circuits = [{ _id: "iris:circuit:0", denied: true }];
    expect((await cctpHealth(now)).status).toBe("degraded");
  });
});
