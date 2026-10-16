import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPoolEventsSince, server } from "../src/lib/stellar";

function latest(sequence: number) {
  vi.spyOn(server, "getLatestLedger").mockResolvedValue({
    sequence,
  } as Awaited<ReturnType<typeof server.getLatestLedger>>);
}

function events(impl: (startLedger?: number) => void) {
  return vi.spyOn(server, "getEvents").mockImplementation(async (req) => {
    impl((req as { startLedger?: number }).startLedger);
    return { events: [], latestLedger: 0 } as unknown as Awaited<
      ReturnType<typeof server.getEvents>
    >;
  });
}

describe("fetchPoolEventsSince", () => {
  afterEach(() => vi.restoreAllMocks());

  it("holds the watermark when the RPC node lags it", async () => {
    latest(100);
    const getEvents = events(() => {});

    await expect(fetchPoolEventsSince(102)).resolves.toEqual({
      events: [],
      scannedFromLedger: 103,
      latestLedger: 102,
    });
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("falls back to a window before the watermark after a transient error", async () => {
    latest(50_000);
    let calls = 0;
    events(() => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
    });

    const result = await fetchPoolEventsSince(49_990);
    expect(result.scannedFromLedger).toBe(50_000 - 17_280);
    expect(result.scannedFromLedger).toBeLessThan(49_991);
  });

  it("fails instead of skipping to the tip when every window errors", async () => {
    latest(50_000);
    events(() => {
      throw new Error("rpc down");
    });

    await expect(fetchPoolEventsSince(49_990)).rejects.toThrow(
      "Pool events unavailable from ledger 49991.",
    );
  });
});
