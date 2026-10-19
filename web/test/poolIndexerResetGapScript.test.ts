// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertTestnet, planReset } from "../scripts/pool-indexer-reset-gap.mjs";

const webRoot = path.resolve(import.meta.dirname, "..");
const now = new Date("2026-10-15T12:00:00Z");

function gapState(overrides: Record<string, unknown> = {}) {
  return {
    _id: "pool",
    poolId: "CPOOL",
    publishedLeafIndex: 9,
    publishedLedger: 5208115,
    health: "degraded",
    nullifiersComplete: false,
    rootsMismatch: false,
    lastError: "Retention gap skipped a ledger window",
    ...overrides,
  };
}

describe("pool indexer retention-gap reset", () => {
  it("refuses mainnet and accepts testnet or the testnet default", () => {
    expect(() => assertTestnet({ NEXT_PUBLIC_STELLAR_NETWORK: "mainnet" })).toThrow(/outside testnet/);
    expect(() => assertTestnet({ NEXT_PUBLIC_STELLAR_NETWORK: "testnet" })).not.toThrow();
    expect(() => assertTestnet({})).not.toThrow();
  });

  it("marks the mirror complete and healthy when roots match", () => {
    const plan = planReset(gapState(), "CPOOL", 10, now);
    expect(plan?.update).toEqual({
      $set: { nullifiersComplete: true, nullifierGapAcknowledgedAt: now, updatedAt: now, health: "healthy" },
      $unset: { pendingGaps: "", incompleteCauses: "", lastError: "" },
    });
    expect(plan?.filter).toMatchObject({ _id: "pool", poolId: "CPOOL", nullifiersComplete: false });
    expect(plan?.summary.healthAfterReset).toBe("healthy");
  });

  it("keeps a root mismatch degraded while still clearing the nullifier flag", () => {
    const plan = planReset(gapState({ rootsMismatch: true }), "CPOOL", 10, now);
    expect(plan?.update.$set).toEqual({ nullifiersComplete: true, nullifierGapAcknowledgedAt: now, updatedAt: now });
    expect(plan?.update.$unset).toEqual({ pendingGaps: "", incompleteCauses: "" });
    expect(plan?.summary.healthAfterReset).toBe("degraded");
  });

  it("abandons pending gaps so the next tick does not re-flag the mirror", () => {
    const pendingGaps = [{ fromLedger: 11, toLedger: 99, firstSeenAt: now, lastReason: "archive_behind" }];
    const plan = planReset(gapState({ pendingGaps, incompleteCauses: ["retention_gap"] }), "CPOOL", 10, now);
    expect(plan?.summary.pendingGaps).toEqual(pendingGaps);
    expect(plan?.update.$unset).toMatchObject({ pendingGaps: "", incompleteCauses: "" });
  });

  it("is a no-op when the mirror is not marked incomplete", () => {
    expect(planReset(gapState({ nullifiersComplete: true }), "CPOOL", 10, now)).toBeNull();
    expect(planReset(gapState({ nullifiersComplete: undefined }), "CPOOL", 10, now)).toBeNull();
  });

  it("refuses missing state, a foreign pool, a held lease, or a deposit gap", () => {
    expect(() => planReset(null, "CPOOL", 0, now)).toThrow(/No pool indexer state/);
    expect(() => planReset(gapState({ poolId: "COTHER" }), "CPOOL", 10, now)).toThrow(/COTHER/);
    expect(() => planReset(gapState({ leaseUntil: new Date(now.getTime() + 1000) }), "CPOOL", 10, now)).toThrow(/mid-sync/);
    expect(planReset(gapState({ leaseUntil: new Date(now.getTime() - 1000) }), "CPOOL", 10, now)).not.toBeNull();
    expect(() => planReset(gapState(), "CPOOL", 9, now)).toThrow(/9 of 10/);
  });

  it("refuses a mainnet env file before touching MongoDB", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "olio-reset-gap-"));
    const envFile = path.join(dir, ".env");
    writeFileSync(
      envFile,
      [
        "MONGODB_URI=mongodb://127.0.0.1:1/olio_dev",
        "MONGO_POOL_STORAGE_SCOPE=CPOOL",
        "NEXT_PUBLIC_OLIO_POOL_ID=CPOOL",
        "NEXT_PUBLIC_STELLAR_NETWORK=mainnet",
      ].join("\n"),
    );
    // Relative path: Node 20.x also parses a trailing --env-file itself and
    // rejects some absolute temp paths before the script runs.
    const result = spawnSync(
      process.execPath,
      ["scripts/pool-indexer-reset-gap.mjs", `--env-file=${path.relative(webRoot, envFile)}`, "--expected-database=olio_dev"],
      { cwd: webRoot, encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/outside testnet/);
  });
});
