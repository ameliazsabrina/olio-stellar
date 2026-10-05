#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2).filter((value) => value !== "--");
const action = args.find((value) => ["status", "up", "down"].includes(value));
const envFile = args
  .find((value) => value.startsWith("--migration-env="))
  ?.slice("--migration-env=".length);
const expectedDatabase = args
  .find((value) => value.startsWith("--expected-database="))
  ?.split("=", 2)[1];
const allowShared = args.includes("--allow-shared-database");
const allowDown = args.includes("--allow-down");

if (!action || !envFile || !expectedDatabase) {
  process.stderr.write(
    "Usage: run-migrations.mjs <status|up|down> --migration-env=PATH --expected-database=NAME [--allow-shared-database] [--allow-down]\n",
  );
  process.exit(2);
}
if (action === "down" && !allowDown) {
  process.stderr.write(
    "Migration rollback requires the explicit --allow-down flag.\n",
  );
  process.exit(2);
}

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const resolvedEnvFile = path.resolve(process.cwd(), envFile);
let contents;
try {
  contents = fs.readFileSync(resolvedEnvFile, "utf8");
} catch {
  process.stderr.write(
    "Unable to read the explicit migration environment file.\n",
  );
  process.exit(2);
}

const values = {};
for (const rawLine of contents.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  values[key] = value;
}

const uri = values.MONGODB_URI;
let databaseName;
try {
  const parsed = new URL(uri);
  databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
} catch {
  process.stderr.write(
    "The environment file must contain a valid MONGODB_URI.\n",
  );
  process.exit(2);
}
if (!databaseName || databaseName !== expectedDatabase) {
  process.stderr.write(
    "MONGODB_URI database does not match --expected-database; refusing to migrate.\n",
  );
  process.exit(2);
}
if (
  !allowShared &&
  ["olio", "production", "prod"].includes(databaseName.toLowerCase())
) {
  process.stderr.write(
    "Refusing a shared-looking database. Use an isolated certification database or explicitly pass --allow-shared-database.\n",
  );
  process.exit(2);
}

const migrateCli = path.join(
  webRoot,
  "node_modules/migrate-mongo/bin/migrate-mongo.js",
);
const child = spawn(
  process.execPath,
  [migrateCli, action, "-f", "migrate-mongo-config.cjs"],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      ...values,
      MONGODB_URI: uri,
      OLIO_REQUIRE_EXPLICIT_MIGRATION_URI: "1",
    },
    stdio: "inherit",
  },
);
child.on("error", () => {
  process.stderr.write("Unable to start migrate-mongo.\n");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
