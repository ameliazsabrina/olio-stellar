#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "./cron-loop.mjs";

export const cctpWorkerDefaults = { route: "cctp-settlement", method: "POST", intervalMs: 5_000, requestTimeoutMs: 300_000, staleAfterMs: 360_000 };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main("cctp-worker", cctpWorkerDefaults).catch((error) => {
    console.error("[cctp-worker]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
