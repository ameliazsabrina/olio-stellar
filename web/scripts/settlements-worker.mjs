#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "./cron-loop.mjs";

export const settlementsWorkerDefaults = {
  route: "settlements-reconcile",
  method: "POST",
  intervalMs: 30_000,
  requestTimeoutMs: 300_000,
  staleAfterMs: 420_000,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main("settlements-worker", settlementsWorkerDefaults).catch((error) => {
    console.error(
      "[settlements-worker]",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
