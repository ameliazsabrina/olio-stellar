// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CctpOperationalError } from "../src/server/modules/cctp/cctp.errors";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  indexes: ["session_quote", "session_due", "session_message"],
  config: {} as Record<string, unknown>,
  network: vi.fn(),
  fee: vi.fn(),
  testnet: vi.fn(),
}));
vi.mock("../src/env", () => ({ env: { NEXT_PUBLIC_OLIO_POOL_ID: "POOL" } }));
vi.mock("../src/server/db/mongo", () => ({
  poolCollectionName: (name: string) => name,
  getDb: async () => ({ collection: () => ({ listIndexes: () => ({ toArray: async () => state.indexes.map(name => ({ name })) }) }) }),
}));
vi.mock("../src/server/modules/cctp/cctp.config", async importOriginal => ({
  ...await importOriginal<typeof import("../src/server/modules/cctp/cctp.config")>(),
  assertCctpTestnet: state.testnet,
  cctpConfig: () => state.config,
}));
vi.mock("../src/server/modules/cctp/cctp.storage", () => ({
  coordination: async () => ({
    findOne: async (filter: { _id: string; until?: { $gt: Date } }) => {
      const row = state.rows.get(filter._id);
      if (!row) return null;
      if (filter.until && !((row.until as Date) > filter.until.$gt)) return null;
      return row;
    },
  }),
}));
vi.mock("../src/server/modules/cctp/cctp.rpc", () => ({ checkSourceNetwork: state.network }));
vi.mock("../src/server/modules/cctp/iris.client", () => ({ standardFee: state.fee }));
import { assertRouteReady, routeReadiness } from "../src/server/modules/cctp/cctp.readiness";

const healthy = () => ({
  CCTP_SESSION_KEY: "ab".repeat(32),
  CCTP_WORKER_ENABLED: "true",
  manifest: { routes: [{ domain: 0, eligible: true, certified: true }, { domain: 5, eligible: true, certified: false }, { domain: 6, eligible: false, certified: false }] },
});

beforeEach(() => {
  state.rows.clear();
  state.indexes = ["session_quote", "session_due", "session_message"];
  state.config = healthy();
  state.network.mockReset().mockResolvedValue(undefined);
  state.fee.mockReset().mockResolvedValue(0);
  state.testnet.mockReset();
  state.rows.set("worker:POOL", { until: new Date(Date.now() + 60_000) });
});
afterEach(() => vi.useRealTimers());

describe("CCTP route readiness gates", () => {
  it("reports enabled when every gate passes", async () => {
    const readiness = await routeReadiness(0);
    expect(readiness).toMatchObject({ state: "enabled", reason: "ready", sourceDomain: 0, retryAfterMs: 15_000 });
    await expect(assertRouteReady(0)).resolves.toBeUndefined();
  });

  it.each([
    ["unknown source domain", () => {}, 2, "unsupported", "unsupported_source"],
    ["mainnet deployment", () => state.testnet.mockImplementation(() => { throw new Error("testnet only"); }), 0, "temporarily_unavailable", "dependency_unavailable"],
    ["missing manifest", () => { state.config = { ...healthy(), manifest: null }; }, 0, "eligibility_unavailable", "eligibility_not_confirmed"],
    ["ineligible route", () => {}, 6, "eligibility_unavailable", "eligibility_not_confirmed"],
    ["uncertified route", () => {}, 5, "temporarily_unavailable", "route_not_certified"],
    ["missing session key", () => { state.config = { ...healthy(), CCTP_SESSION_KEY: undefined }; }, 0, "temporarily_unavailable", "route_not_certified"],
    ["worker disabled by config", () => { state.config = { ...healthy(), CCTP_WORKER_ENABLED: "false" }; }, 0, "temporarily_unavailable", "route_not_certified"],
    ["upstream denial flagged for investigation", () => state.rows.set("iris:circuit:0", { denied: true, nextAt: new Date(0) }), 0, "temporarily_unavailable", "upstream_denied_investigate"],
    ["upstream circuit open", () => state.rows.set("iris:circuit:0", { failures: 3, nextAt: new Date(Date.now() + 45_000) }), 0, "temporarily_unavailable", "upstream_backoff"],
    ["worker heartbeat expired", () => state.rows.set("worker:POOL", { until: new Date(Date.now() - 1) }), 0, "temporarily_unavailable", "worker_unavailable"],
    ["worker heartbeat absent", () => state.rows.delete("worker:POOL"), 0, "temporarily_unavailable", "worker_unavailable"],
    ["session indexes missing", () => { state.indexes = ["session_quote"]; }, 0, "temporarily_unavailable", "storage_not_ready"],
    ["source RPC unreachable", () => state.network.mockRejectedValue(new CctpOperationalError("transport")), 0, "temporarily_unavailable", "transport"],
    ["source RPC generic failure", () => state.network.mockRejectedValue(new Error("boom")), 0, "temporarily_unavailable", "dependency_unavailable"],
    ["provider fee requires gross-up", () => state.fee.mockResolvedValue(1), 0, "unsupported", "provider_fee_requires_gross_up"],
    ["provider fee lookup throttled", () => state.fee.mockRejectedValue(new CctpOperationalError("throttled", 9000)), 0, "temporarily_unavailable", "throttled"],
  ] as const)("%s", async (_label, arrange, domain, expectedState, expectedReason) => {
    arrange();
    const readiness = await routeReadiness(domain);
    expect(readiness).toMatchObject({ state: expectedState, reason: expectedReason, sourceDomain: domain });
    await expect(assertRouteReady(domain)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("carries the circuit breaker's remaining backoff as retryAfterMs", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-11T10:00:00Z") });
    state.rows.set("iris:circuit:0", { failures: 2, nextAt: new Date(Date.now() + 42_000) });
    const readiness = await routeReadiness(0);
    expect(readiness.reason).toBe("upstream_backoff");
    expect(readiness.retryAfterMs).toBe(42_000);
  });

  it("checks gates in order so expensive network probes are skipped behind a closed gate", async () => {
    state.rows.delete("worker:POOL");
    await routeReadiness(0);
    expect(state.network).not.toHaveBeenCalled();
    expect(state.fee).not.toHaveBeenCalled();
  });
});
