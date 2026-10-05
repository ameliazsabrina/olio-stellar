// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repository = path.resolve(import.meta.dirname, "../..");
const script = path.join(repository, "scripts/certify-testnet.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repository,
    encoding: "utf8",
  });
}

describe("testnet certification evidence recorder", () => {
  it("initializes the complete matrix as not run", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "olio-cert-init-"));
    const directory = path.join(parent, "run");
    const result = run(["init", `--run-dir=${directory}`]);

    expect(result.status, result.stderr).toBe(0);
    const cases = JSON.parse(
      readFileSync(path.join(directory, "cases.json"), "utf8"),
    );
    expect(cases).toHaveLength(28);
    expect(
      cases.every(({ status }: { status: string }) => status === "NOT RUN"),
    ).toBe(true);
    expect(readFileSync(path.join(directory, "report.md"), "utf8")).toContain(
      "Release gate: NOT CERTIFIED",
    );
  });

  it("rejects confidential evidence", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "olio-cert-secret-"));
    const directory = path.join(parent, "run");
    expect(run(["init", `--run-dir=${directory}`]).status).toBe(0);
    const evidence = path.join(parent, "evidence.json");
    writeFileSync(evidence, JSON.stringify({ signerSecret: "redacted" }));

    const result = run([
      "record",
      `--run-dir=${directory}`,
      "--case=CFG-01",
      "--status=BLOCKED",
      `--evidence=${evidence}`,
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("prohibited confidential field");
  });

  it("requires valid accounting and substantive pass evidence", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "olio-cert-pass-"));
    const directory = path.join(parent, "run");
    expect(run(["init", `--run-dir=${directory}`]).status).toBe(0);
    const evidence = path.join(parent, "evidence.json");
    writeFileSync(
      evidence,
      JSON.stringify({
        channel: "direct",
        accounting: { principal: "100", feeBps: "200", fee: "2", gross: "102" },
        transactionHashes: [],
        expectedVsActual: {},
      }),
    );

    const result = run([
      "record",
      `--run-dir=${directory}`,
      "--case=DIR-01",
      "--status=PASS",
      `--evidence=${evidence}`,
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("transaction hash");
  });
});
