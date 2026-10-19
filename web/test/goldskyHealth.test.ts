import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  findOne: vi.fn(),
  getLatestLedger: vi.fn(),
}));
vi.mock("../src/env.server", () => ({ getServerEnv: () => mocks.env }));
vi.mock("../src/lib/stellar", () => ({
  server: { getLatestLedger: mocks.getLatestLedger },
}));
vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({ findOne: mocks.findOne })),
}));
vi.mock("../src/server/modules/goldsky/goldsky.events", () => ({
  GOLDSKY_HEARTBEAT_MARGIN: 720,
}));

import { GET } from "../src/app/api/health/goldsky/route";
import { goldskyHealth } from "../src/server/modules/goldsky/goldsky.health";

const ON = { POOL_GAP_FILL_SOURCE: "goldsky", GOLDSKY_WEBHOOK_SECRET: "s" };
// Rollout: the archive runs, gap fill is still off.
const ARCHIVE_ONLY = {
  POOL_GAP_FILL_SOURCE: "off",
  GOLDSKY_WEBHOOK_SECRET: "s",
};

describe("goldskyHealth", () => {
  beforeEach(() => {
    mocks.env = { ...ON };
    mocks.findOne.mockReset();
    mocks.getLatestLedger.mockReset();
    mocks.getLatestLedger.mockResolvedValue({ sequence: 10_000 });
  });

  it("is disabled only when the webhook secret is unset", async () => {
    mocks.env = { POOL_GAP_FILL_SOURCE: "off" };
    await expect(goldskyHealth()).resolves.toEqual({
      status: "disabled",
      gapFillSource: "off",
    });
    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it("reports the real archive status while gap fill is still off", async () => {
    mocks.env = { ...ARCHIVE_ONLY };
    mocks.findOne.mockResolvedValue({ lastLedger: 9_000, rejectedRows: 0 });
    await expect(goldskyHealth()).resolves.toMatchObject({
      status: "lagging",
      gapFillSource: "off",
      lastLedger: 9_000,
      lagLedgers: 1_000,
    });
  });

  it("is healthy near the tip, lagging past the margin", async () => {
    mocks.findOne.mockResolvedValue({ lastLedger: 9_500, rejectedRows: 0 });
    await expect(goldskyHealth()).resolves.toMatchObject({
      status: "healthy",
      gapFillSource: "goldsky",
      lagLedgers: 500,
    });
    mocks.findOne.mockResolvedValue({ lastLedger: 9_000, rejectedRows: 0 });
    await expect(goldskyHealth()).resolves.toMatchObject({
      status: "lagging",
      lagLedgers: 1_000,
    });
  });

  it("is degraded after rejected rows or a correction", async () => {
    mocks.findOne.mockResolvedValue({ lastLedger: 9_990, rejectedRows: 2 });
    await expect(goldskyHealth()).resolves.toMatchObject({
      status: "degraded",
    });
    mocks.findOne.mockResolvedValue({
      lastLedger: 9_990,
      correctionAt: new Date(),
    });
    await expect(goldskyHealth()).resolves.toMatchObject({
      status: "degraded",
    });
  });
});

describe("GET /api/health/goldsky", () => {
  beforeEach(() => {
    mocks.env = { ...ON };
    mocks.findOne.mockReset();
    mocks.getLatestLedger.mockReset();
    mocks.getLatestLedger.mockResolvedValue({ sequence: 10_000 });
  });

  it("fails only when gap fill relies on an unhealthy archive", async () => {
    mocks.findOne.mockResolvedValue({ lastLedger: 9_000, rejectedRows: 0 });
    const failing = await GET();
    expect(failing.status).toBe(503);
    await expect(failing.json()).resolves.toMatchObject({
      status: "lagging",
      gapFillSource: "goldsky",
    });

    mocks.findOne.mockResolvedValue({ lastLedger: 9_900, rejectedRows: 0 });
    expect((await GET()).status).toBe(200);
  });

  it("returns 200 with the true status while gap fill is off", async () => {
    mocks.env = { ...ARCHIVE_ONLY };
    mocks.findOne.mockResolvedValue({ lastLedger: 9_000, rejectedRows: 3 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      gapFillSource: "off",
      rejectedRows: 3,
    });
  });

  it("returns 200 when disabled", async () => {
    mocks.env = { POOL_GAP_FILL_SOURCE: "off" };
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "disabled",
      gapFillSource: "off",
    });
  });

  it("logs and reports unavailable when the check throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getLatestLedger.mockRejectedValue(new Error("rpc down"));
    mocks.findOne.mockResolvedValue({ lastLedger: 9_900 });

    const failing = await GET();
    expect(failing.status).toBe(503);
    await expect(failing.json()).resolves.toEqual({
      status: "unavailable",
      gapFillSource: "goldsky",
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0].join(" "))).toContain("rpc down");
    expect(String(error.mock.calls[0].join(" "))).not.toContain("s3cret");

    mocks.env = { ...ARCHIVE_ONLY };
    const rollout = await GET();
    expect(rollout.status).toBe(200);
    await expect(rollout.json()).resolves.toEqual({
      status: "unavailable",
      gapFillSource: "off",
    });
    error.mockRestore();
  });

  it("fails closed when the env itself cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.env = new Proxy(
      {},
      {
        get() {
          throw new Error("bad env");
        },
      },
    );
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    error.mockRestore();
  });
});
