#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "./cron-loop.mjs";

export const evidenceWorkerDefaults = {
  route: "evidence-epoch",
  method: "POST",
  intervalMs: 300_000,
  requestTimeoutMs: 300_000,
  staleAfterMs: 900_000,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main("evidence-worker", evidenceWorkerDefaults).catch((error) => {
    console.error(
      "[evidence-worker]",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
