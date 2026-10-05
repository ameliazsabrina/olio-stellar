// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthy, loopConfig, runLoop, tick } from "../scripts/cron-loop.mjs";
import { cctpWorkerDefaults } from "../scripts/cctp-worker.mjs";
import { poolIndexerDefaults } from "../scripts/pool-indexer.mjs";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "olio-loop-"));
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("OLIO_BASE_URL", "http://web:3000/");
  vi.stubEnv("CCTP_WORKER_HEARTBEAT_FILE", path.join(directory, "cctp.heartbeat"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("shared cron loop", () => {
  it("derives the sidecar configuration from the environment with cadence overrides", () => {
    vi.stubEnv("CCTP_WORKER_INTERVAL_MS", "2000");
    const config = loopConfig("cctp-worker", cctpWorkerDefaults);
    expect(config).toMatchObject({ url: "http://web:3000/api/cron/cctp-settlement", method: "POST", intervalMs: 2000, requestTimeoutMs: 300_000, staleAfterMs: 360_000, secret: "s3cret" });
    expect(loopConfig("pool-indexer", poolIndexerDefaults)).toMatchObject({ url: "http://web:3000/api/cron/pool-indexer", method: "POST", intervalMs: 60_000, staleAfterMs: 180_000 });
    vi.stubEnv("CCTP_WORKER_INTERVAL_MS", "0");
    expect(() => loopConfig("cctp-worker", cctpWorkerDefaults)).toThrow();
  });

  it("posts with the bearer secret and records a heartbeat only on success", async () => {
    const config = loopConfig("cctp-worker", cctpWorkerDefaults);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 503 })).mockResolvedValueOnce(Response.json({ status: "idle" }));
    expect((await tick(config, fetchImpl)).ok).toBe(false);
    expect(healthy(config)).toBe(false);
    expect((await tick(config, fetchImpl)).ok).toBe(true);
    expect(fetchImpl).toHaveBeenLastCalledWith("http://web:3000/api/cron/cctp-settlement", expect.objectContaining({ method: "POST", headers: { authorization: "Bearer s3cret" } }));
    expect(healthy(config)).toBe(true);
    expect(healthy(config, Date.now() + config.staleAfterMs + 1)).toBe(false);
  });

  it("treats a transport failure as unhealthy without crashing the loop", async () => {
    const config = loopConfig("cctp-worker", cctpWorkerDefaults);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await tick(config, fetchImpl)).ok).toBe(false);
    expect(healthy(config)).toBe(false);
  });

  it("reports unhealthy on a corrupt or stale heartbeat file", () => {
    const config = loopConfig("cctp-worker", cctpWorkerDefaults);
    writeFileSync(config.heartbeatFile, "not-a-timestamp");
    expect(healthy(config)).toBe(false);
    writeFileSync(config.heartbeatFile, String(Date.now() - config.staleAfterMs - 1));
    expect(healthy(config)).toBe(false);
    writeFileSync(config.heartbeatFile, String(Date.now()));
    expect(healthy(config)).toBe(true);
    expect(Number(readFileSync(config.heartbeatFile, "utf8"))).toBeGreaterThan(0);
  });

  it("keeps looping through failures and honours the interval between ticks", async () => {
    const config = loopConfig("cctp-worker", cctpWorkerDefaults);
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(Response.json({ status: "idle" }));
    const sleep = vi.fn(async () => {});
    await runLoop(config, { fetch: fetchImpl, sleep, shouldContinue: () => fetchImpl.mock.calls.length < 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(config.intervalMs);
  });

  it("refuses to start without a secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    await expect(runLoop(loopConfig("cctp-worker", cctpWorkerDefaults), { fetch: vi.fn() })).rejects.toThrow(/CRON_SECRET/);
  });
});
