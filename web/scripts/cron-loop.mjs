import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function loopConfig(name, defaults) {
  const upper = name.toUpperCase().replaceAll("-", "_");
  const read = (key, fallback) => {
    const value = process.env[key];
    return value === undefined || value.trim() === "" ? fallback : value.trim();
  };
  const interval = Number(read(`${upper}_INTERVAL_MS`, defaults.intervalMs));
  const requestTimeout = Number(read(`${upper}_REQUEST_TIMEOUT_MS`, defaults.requestTimeoutMs));
  const staleAfter = Number(read(`${upper}_HEALTH_STALE_MS`, defaults.staleAfterMs ?? requestTimeout + 60_000));
  if (![interval, requestTimeout, staleAfter].every((v) => Number.isInteger(v) && v > 0)) {
    throw new Error(`${name}: interval, timeout, and health thresholds must be positive integers.`);
  }
  return {
    name,
    url: `${read("OLIO_BASE_URL", "http://localhost:3000").replace(/\/$/, "")}/api/cron/${defaults.route}`,
    method: defaults.method,
    secret: read("CRON_SECRET", ""),
    intervalMs: interval,
    requestTimeoutMs: requestTimeout,
    staleAfterMs: staleAfter,
    heartbeatFile: read(`${upper}_HEARTBEAT_FILE`, path.join(os.tmpdir(), `olio-${name}.heartbeat`)),
  };
}

export function healthy(config, now = Date.now()) {
  try {
    const written = Number(fs.readFileSync(config.heartbeatFile, "utf8"));
    return Number.isFinite(written) && now - written < config.staleAfterMs;
  } catch {
    return false;
  }
}

export async function tick(config, fetchImpl = fetch) {
  const started = Date.now();
  try {
    const response = await fetchImpl(config.url, {
      method: config.method,
      headers: { authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
    fs.writeFileSync(config.heartbeatFile, String(Date.now()));
    console.log(`[${config.name}]`, body.slice(0, 2000));
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    console.error(`[${config.name}]`, error instanceof Error ? error.message : String(error));
    return { ok: false, latencyMs: Date.now() - started };
  }
}

export async function runLoop(config, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const shouldContinue = options.shouldContinue ?? (() => true);
  if (!config.secret) throw new Error(`${config.name}: CRON_SECRET is required.`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`[${config.name}] polling ${config.url} every ${config.intervalMs}ms`);
  while (!stopping && shouldContinue()) {
    await tick(config, fetchImpl);
    if (stopping || !shouldContinue()) break;
    await sleep(config.intervalMs);
  }
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}

export async function main(name, defaults, argv = process.argv.slice(2)) {
  const config = loopConfig(name, defaults);
  if (argv.includes("--health")) {
    process.exit(healthy(config) ? 0 : 1);
  }
  if (argv.includes("--once")) {
    const result = await tick(config);
    process.exit(result.ok ? 0 : 1);
  }
  await runLoop(config);
}
