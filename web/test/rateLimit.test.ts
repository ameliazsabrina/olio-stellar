// @vitest-environment node
import { __resetRateLimit, rateLimit } from "../src/server/lib/rateLimit";

beforeEach(() => __resetRateLimit());

describe("rateLimit", () => {
  it("allows up to the limit within a window, then blocks with a retry hint", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(rateLimit("k", 5, 1000, t0).ok).toBe(true);
    }
    const blocked = rateLimit("k", 5, 1000, t0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it("resets once the window elapses", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i += 1) rateLimit("k", 5, 1000, t0);
    expect(rateLimit("k", 5, 1000, t0).ok).toBe(false);
    // At the window boundary the allowance is fresh again.
    expect(rateLimit("k", 5, 1000, t0 + 1000).ok).toBe(true);
  });

  it("tracks keys independently (per-credential and per-IP don't bleed)", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 5; i += 1) rateLimit("a", 5, 1000, t0);
    expect(rateLimit("a", 5, 1000, t0).ok).toBe(false);
    expect(rateLimit("b", 5, 1000, t0).ok).toBe(true);
  });
});
