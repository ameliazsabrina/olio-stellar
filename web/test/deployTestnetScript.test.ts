// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repository = path.resolve(import.meta.dirname, "../..");
const script = path.join(repository, "scripts/deploy-testnet.sh");
const validTreasury =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function run(args: string[]) {
  return spawnSync("bash", [script, ...args], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      FEE_RECIPIENT: validTreasury,
      FEE_QUOTE_SIGNING_SECRET: "",
      FEE_QUOTE_SIGNER_PUBLIC_KEY: "",
    },
  });
}

describe("preservation-oriented testnet deployment", () => {
  it("performs a write-free explicit-new-registry dry run", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "olio-deploy-dry-"));
    const envFile = path.join(directory, "certification.env");
    const manifest = path.join(directory, "manifest.json");
    const result = run([
      "--new-registry",
      "--env-file",
      envFile,
      "--manifest",
      manifest,
      "--dry-run",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "No build, funding, deployment, upload, or write",
    );
    expect(result.stdout).toContain("new (explicit)");
  });

  it("refuses an implicit fresh registry", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "olio-deploy-preserve-"));
    const result = run([
      "--env-file",
      path.join(directory, "empty.env"),
      "--dry-run",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No registry configured");
  });

  it("rejects a resume manifest for another network before writes", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "olio-deploy-resume-"));
    const manifest = path.join(directory, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ network: "mainnet" }));
    const result = run([
      "--resume",
      manifest,
      "--env-file",
      path.join(directory, "certification.env"),
      "--dry-run",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not for testnet");
  });
});
