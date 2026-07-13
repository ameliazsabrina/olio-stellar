import "server-only";

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  sweep(now);
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (w.count >= limit) return { ok: false, retryAfterMs: w.resetAt - now };
  w.count += 1;
  return { ok: true, retryAfterMs: 0 };
}

function sweep(now: number): void {
  if (buckets.size < 1024) return;
  for (const [key, w] of buckets) if (now >= w.resetAt) buckets.delete(key);
}

// Test-only: clear all windows between cases.
export function __resetRateLimit(): void {
  buckets.clear();
}
