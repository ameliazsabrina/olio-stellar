#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "./cron-loop.mjs";

export const verificationWorkerDefaults = {
  route: "verification-reconciliation",
  method: "POST",
  intervalMs: 15_000,
  requestTimeoutMs: 300_000,
  staleAfterMs: 600_000,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main("verification-worker", verificationWorkerDefaults).catch((error) => {
    console.error(
      "[verification-worker]",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
