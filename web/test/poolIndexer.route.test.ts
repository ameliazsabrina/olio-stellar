import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));

vi.mock("../src/server/modules/deposits/deposits.service", () => ({
  syncPoolIndex: mocks.sync,
}));

describe("pool indexer cron route", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    mocks.sync.mockReset();
  });

  it("fails closed without a matching cron secret", async () => {
    process.env.CRON_SECRET = "expected";
    const { GET } = await import("../src/app/api/cron/pool-indexer/route");
    const response = await GET(
      new Request("http://localhost/api/cron/pool-indexer"),
    );

    expect(response.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("runs an authorized synchronization", async () => {
    process.env.CRON_SECRET = "expected";
    mocks.sync.mockResolvedValue({
      status: "synced",
      fromLedger: 10,
      toLedger: 12,
      depositsUpserted: 1,
      nullifiersUpserted: 1,
      durationMs: 5,
    });
    const { GET } = await import("../src/app/api/cron/pool-indexer/route");
    const response = await GET(
      new Request("http://localhost/api/cron/pool-indexer", {
        headers: { authorization: "Bearer expected" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
});
