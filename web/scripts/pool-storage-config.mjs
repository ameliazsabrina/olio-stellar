import fs from "node:fs";
import path from "node:path";

const SHARED_DATABASE_NAMES = new Set(["olio", "production", "prod"]);

export function parsePoolStorageArgs(argv) {
  const args = argv.filter((value) => value !== "--");
  const value = (name) =>
    args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
  return {
    envFile: value("--env-file"),
    expectedDatabase: value("--expected-database"),
    confirmScope: value("--confirm-scope"),
    backupDir: value("--backup-dir"),
    allowSharedDatabase: args.includes("--allow-shared-database"),
    execute: args.includes("--execute"),
  };
}

function readEnvironmentFile(file) {
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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
  return values;
}

export function loadPoolStorageConfig(options) {
  if (!options.envFile || !options.expectedDatabase) {
    throw new Error(
      "Both --env-file=PATH and --expected-database=NAME are required.",
    );
  }
  const envPath = path.resolve(process.cwd(), options.envFile);
  const values = readEnvironmentFile(envPath);
  const uri = values.MONGODB_URI;
  let databaseName;
  try {
    const parsed = new URL(uri);
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("The environment file must contain a valid MONGODB_URI.");
  }
  if (!databaseName || databaseName !== options.expectedDatabase) {
    throw new Error(
      "MONGODB_URI database does not match --expected-database; refusing the operation.",
    );
  }
  if (
    !options.allowSharedDatabase &&
    SHARED_DATABASE_NAMES.has(databaseName.toLowerCase())
  ) {
    throw new Error(
      "Refusing a shared-looking database. Pass --allow-shared-database only after verifying the exact target.",
    );
  }

  const scope = values.MONGO_POOL_STORAGE_SCOPE;
  const poolId = values.NEXT_PUBLIC_OLIO_POOL_ID;
  if (!scope || !/^[A-Za-z0-9_-]{1,64}$/.test(scope)) {
    throw new Error("A valid MONGO_POOL_STORAGE_SCOPE is required.");
  }
  if (scope !== poolId) {
    throw new Error("Pool storage scope must equal NEXT_PUBLIC_OLIO_POOL_ID.");
  }
  return { databaseName, envPath, scope, uri };
}

export const POOL_COLLECTION_BASES = [
  "deposits",
  "spent_nullifiers",
  "indexer_state",
  "pool_fees",
  "cctp_relays",
  "async_fee_quote_contexts",
];
