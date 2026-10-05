#!/usr/bin/env node

import fs from "node:fs";

function loadEnvironmentFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (Object.hasOwn(process.env, key)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvironmentFile(".env.local");
const { checkFeeQuoteReadiness } = await import(
  "../src/server/modules/feeQuotes/feeQuotes.readiness.ts"
);

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const requestedChannel = process.argv
  .slice(2)
  .find((value) => value.startsWith("--channel="))
  ?.slice("--channel=".length);
const channels = ["direct", "cctp"];

if (requestedChannel && !channels.includes(requestedChannel)) {
  process.stderr.write("--channel must be direct or cctp.\n");
  process.exitCode = 2;
} else {
  try {
    const report = await checkFeeQuoteReadiness();
    const publicReport = {
      checkedAt: report.checkedAt,
      network: report.network,
      ready: requestedChannel
        ? report.channels[requestedChannel].ready
        : report.ready,
      channels: report.channels,
      diagnostics: report.diagnostics.map(
        ({ code, severity, channels: affectedChannels, message }) => ({
          code,
          severity,
          channels: affectedChannels,
          message,
        }),
      ),
    };
    if (asJson) {
      process.stdout.write(`${JSON.stringify(publicReport, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Testnet readiness: ${publicReport.ready ? "READY" : "BLOCKED"}\n`,
      );
      for (const channel of channels) {
        process.stdout.write(
          `  ${channel}: ${report.channels[channel].ready ? "ready" : "blocked"}\n`,
        );
      }
      for (const item of publicReport.diagnostics) {
        if (!requestedChannel || item.channels.includes(requestedChannel)) {
          process.stdout.write(
            `  [${item.severity}] ${item.code}: ${item.message}\n`,
          );
        }
      }
    }
    if (!publicReport.ready) process.exitCode = 1;
  } catch {
    process.stderr.write(
      "Readiness check failed before a sanitized report could be produced.\n",
    );
    process.exitCode = 1;
  }
}
