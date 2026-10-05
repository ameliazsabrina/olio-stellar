// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(webRoot, "scripts/run-migrations.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, ["--", script, ...args], {
    cwd: webRoot,
    encoding: "utf8",
  });
}

function environmentFile(uri: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "olio-migration-"));
  const file = path.join(directory, "migration.env");
  writeFileSync(file, `MONGODB_URI=${uri}\n`);
  return file;
}

describe("guarded migration runner", () => {
  it("rejects a database name that differs from the explicit expectation", () => {
    const file = environmentFile("mongodb://127.0.0.1:27017/actual");
    const result = run([
      "status",
      `--migration-env=${file}`,
      "--expected-database=expected",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not match");
  });

  it("rejects shared-looking databases unless explicitly overridden", () => {
    const file = environmentFile("mongodb://127.0.0.1:27017/olio");
    const result = run([
      "up",
      `--migration-env=${file}`,
      "--expected-database=olio",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("shared-looking database");
  });

  it("requires a separate destructive rollback acknowledgement", () => {
    const file = environmentFile("mongodb://127.0.0.1:27017/isolated");
    const result = run([
      "down",
      `--migration-env=${file}`,
      "--expected-database=isolated",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--allow-down");
  });
});
