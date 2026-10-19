#!/usr/bin/env node
// Renders the Goldsky Turbo pipeline for one environment's pool, so the
// contract id, network and start ledger come from the env file the app uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvironmentFile } from "./pool-storage-config.mjs";

export function renderPipeline({
  network,
  poolId,
  startLedger,
  webhookUrl,
  secretName,
}) {
  if (!["testnet", "mainnet"].includes(network))
    throw new Error(`Unsupported network ${network}`);
  if (!/^C[A-Z2-7]{55}$/.test(poolId ?? ""))
    throw new Error("Invalid pool contract id");
  if (!Number.isInteger(startLedger) || startLedger < 1)
    throw new Error("Invalid start ledger");
  if (!/^https:\/\//.test(webhookUrl ?? ""))
    throw new Error("Webhook URL must be https");
  // Heartbeats are marker rows from the SAME events stream, transform and
  // sink as the pool rows: the events of the first transaction in every 60th
  // ledger. A heartbeat therefore only ever proves progress of the stream that
  // carries the pool events. Both kinds carry pool_id, so a pipeline left
  // running for an old pool cannot advance the new pool's watermark.
  return `name: olio-pool-${network}-${poolId.slice(0, 8).toLowerCase()}
resource_size: xs
sources:
  pool_events:
    type: dataset
    dataset_name: stellar_${network}.events
    version: 1.2.0
    start_at: ${startLedger}
transforms:
  pool_rows:
    type: sql
    primary_key: id
    sql: |
      SELECT id,
             CASE WHEN contract_id = '${poolId}' THEN 'event' ELSE 'heartbeat' END AS kind,
             '${poolId}' AS pool_id,
             contract_id, topics, data, transaction_hash, transaction_index, ledger_sequence, ledger_closed_at
      FROM pool_events
      WHERE (type = 'contract' AND in_successful_contract_call = true AND contract_id = '${poolId}')
         OR (ledger_sequence % 60 = 0 AND transaction_index = 0 AND contract_id <> '${poolId}')
sinks:
  pool_rows_webhook:
    type: webhook
    from: pool_rows
    url: ${webhookUrl}
    secret_name: ${secretName}
    batch_size: 100
    batch_flush_interval: 2s
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name) =>
    process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const envFile = arg("--env-file");
  const out = arg("--out");
  if (!envFile || !out || !arg("--url")) {
    process.stderr.write(
      "Usage: goldsky-pipeline.mjs --env-file=PATH --url=https://HOST/api/goldsky/pool-events --out=PATH [--secret-name=OLIO_GOLDSKY_WEBHOOK]\n",
    );
    process.exit(2);
  }
  const env = readEnvironmentFile(path.resolve(process.cwd(), envFile));
  const yaml = renderPipeline({
    network: env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
    poolId: env.NEXT_PUBLIC_OLIO_POOL_ID,
    startLedger: Number(env.GOLDSKY_PIPELINE_START_LEDGER),
    webhookUrl: arg("--url"),
    secretName: arg("--secret-name") ?? "OLIO_GOLDSKY_WEBHOOK",
  });
  fs.writeFileSync(path.resolve(process.cwd(), out), yaml);
  process.stdout.write(`Wrote ${out}\n`);
}
