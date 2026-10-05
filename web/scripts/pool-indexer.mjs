#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "./cron-loop.mjs";

export const poolIndexerDefaults = { route: "pool-indexer", method: "POST", intervalMs: 60_000, requestTimeoutMs: 60_000, staleAfterMs: 180_000 };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main("pool-indexer", poolIndexerDefaults).catch((error) => {
    console.error("[pool-indexer]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
