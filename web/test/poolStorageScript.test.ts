// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");

function environmentFile(database = "olio") {
  const directory = mkdtempSync(path.join(tmpdir(), "olio-storage-"));
  const file = path.join(directory, "storage.env");
  writeFileSync(
    file,
    [
      `MONGODB_URI=mongodb://127.0.0.1:27017/${database}`,
      "MONGO_POOL_STORAGE_SCOPE=CPOOL",
      "NEXT_PUBLIC_OLIO_POOL_ID=CPOOL",
      "",
    ].join("\n"),
  );
  return file;
}

function run(scriptName: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--", path.join(webRoot, "scripts", scriptName), ...args],
    { cwd: webRoot, encoding: "utf8" },
  );
}

describe("guarded pool storage scripts", () => {
  it("requires an explicit environment and database", () => {
    const result = run("initialize-pool-storage.mjs", []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--env-file");
  });

  it("rejects a database other than the explicit target", () => {
    const result = run("initialize-pool-storage.mjs", [
      `--env-file=${environmentFile("actual")}`,
      "--expected-database=expected",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not match");
  });

  it("requires exact scope confirmation before an executed reset", () => {
    const result = run("reset-pool-storage.mjs", [
      `--env-file=${environmentFile()}`,
      "--expected-database=olio",
      "--allow-shared-database",
      "--execute",
      "--confirm-scope=COTHER",
      `--backup-dir=${tmpdir()}`,
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("exactly match");
  });
});
