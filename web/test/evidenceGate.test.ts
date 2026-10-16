import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/stellar", () => ({
  poolId: "CPOOL",
  stellarNetwork: "testnet",
}));

import { assertEvidenceSignerSeparation } from "../src/env.server-schema";
import type { IndexerStateDoc } from "../src/server/db/mongo";
import type { EvidenceConfig } from "../src/server/modules/evidence/evidence.config";
import {
  credentialBacksNetwork,
  evaluateIssuanceGate,
  evaluateRecordsGate,
} from "../src/server/modules/evidence/evidence.gate";

const config: EvidenceConfig = {
  mode: "testnet",
  keyId: "olio-ev-1",
  signerPublicKey: Keypair.random().publicKey(),
  anchorPublicKey: Keypair.random().publicKey(),
  intervalSeconds: 86_400,
  policyVersion: 1,
  manifestTtlDays: 30,
};

const healthyPool: IndexerStateDoc = {
  _id: "pool",
  lastLedger: 100,
  poolId: "CPOOL",
  publishedLeafIndex: 9,
  health: "healthy",
  nullifiersComplete: true,
  rootLeafCount: 10,
  rootsVerifiedAt: new Date(),
  rootsMismatch: false,
  updatedAt: new Date(),
};

const reconciled: IndexerStateDoc = {
  _id: "settlements",
  lastLedger: 0,
  lastLeafIndex: 9,
  health: "healthy",
  updatedAt: new Date(),
};

describe("records gate", () => {
  it("ignores evidence config and reports when the index was published", () => {
    const indexedAt = new Date("2026-10-15T08:55:00.000Z");
    expect(
      evaluateRecordsGate({
        pool: { ...healthyPool, indexedAt },
        settlements: reconciled,
      }),
    ).toEqual({ open: true, reasons: [], asOf: indexedAt });
  });

  it("stays closed with no time before the pool index is published", () => {
    expect(
      evaluateRecordsGate({
        pool: { ...healthyPool, poolId: "COTHER" },
        settlements: reconciled,
      }),
    ).toEqual({ open: false, reasons: ["pool_index_unpublished"], asOf: null });
  });

  it("closes while reconcile is behind but keeps the time", () => {
    const gate = evaluateRecordsGate({
      pool: healthyPool,
      settlements: { ...reconciled, lastLeafIndex: 7 },
    });
    expect(gate.reasons).toEqual(["reconcile_behind"]);
    expect(gate.asOf).toBe(healthyPool.updatedAt);
  });
});

describe("evidence issuance gate", () => {
  it("opens only when every safety condition holds", () => {
    expect(
      evaluateIssuanceGate({
        config,
        pool: healthyPool,
        settlements: reconciled,
      }),
    ).toEqual({ open: true, reasons: [] });
  });

  it.each([
    [{ health: "degraded" as const }, "pool_index_degraded"],
    [{ nullifiersComplete: false }, "nullifiers_incomplete"],
    [{ rootsMismatch: true }, "pool_roots_mismatch"],
    [{ rootsVerifiedAt: undefined }, "pool_roots_unverified"],
    [{ rootLeafCount: 8 }, "pool_roots_unverified"],
  ])("halts when the pool index is unsafe (%o)", (change, reason) => {
    const gate = evaluateIssuanceGate({
      config,
      pool: { ...healthyPool, ...change },
      settlements: reconciled,
    });
    expect(gate.open).toBe(false);
    expect(gate.reasons).toContain(reason);
  });

  it("halts while reconcile is behind the published deposits", () => {
    const gate = evaluateIssuanceGate({
      config,
      pool: healthyPool,
      settlements: { ...reconciled, lastLeafIndex: 7 },
    });
    expect(gate.reasons).toContain("reconcile_behind");
  });

  it("halts when disabled, misconfigured, or on the wrong network", () => {
    expect(
      evaluateIssuanceGate({
        config: { ...config, mode: "off" },
        pool: healthyPool,
        settlements: reconciled,
      }).reasons,
    ).toContain("evidence_disabled");
    expect(
      evaluateIssuanceGate({
        config: { ...config, mode: "mainnet" },
        pool: healthyPool,
        settlements: reconciled,
      }).reasons,
    ).toContain("network_mismatch");
    expect(
      evaluateIssuanceGate({
        config: { ...config, signerPublicKey: null, anchorPublicKey: null },
        pool: healthyPool,
        settlements: reconciled,
      }).reasons,
    ).toEqual(expect.arrayContaining(["signer_missing", "anchor_missing"]));
  });

  it("lets a sandbox credential back testnet but never mainnet", () => {
    const now = new Date();
    const credential = {
      _id: "cred",
      businessId: "biz",
      environment: "sandbox" as const,
      caseId: "case",
      caseRevision: 1,
      issuer: "olio" as const,
      policyVersion: 1,
      checkedAt: now,
      validUntil: new Date(now.getTime() + 86_400_000),
      status: "active" as const,
      suspensionReason: null,
      published: false,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const verification = {
      environment: "sandbox" as const,
    } as Parameters<typeof credentialBacksNetwork>[3];
    expect(
      credentialBacksNetwork(credential, now, "testnet", verification),
    ).toBe(true);
    expect(
      credentialBacksNetwork(credential, now, "mainnet", verification),
    ).toBe(false);
    expect(
      credentialBacksNetwork(
        { ...credential, status: "suspended" },
        now,
        "testnet",
        verification,
      ),
    ).toBe(false);
  });

  it("rejects a credential from another Sumsub environment", () => {
    const now = new Date();
    const credential = {
      _id: "cred",
      businessId: "biz",
      environment: "sandbox" as const,
      caseId: "case",
      caseRevision: 1,
      issuer: "olio" as const,
      policyVersion: 1,
      checkedAt: now,
      validUntil: new Date(now.getTime() + 86_400_000),
      status: "active" as const,
      suspensionReason: null,
      published: false,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const live = {
      environment: "live" as const,
    } as Parameters<typeof credentialBacksNetwork>[3];
    expect(credentialBacksNetwork(credential, now, "testnet", live)).toBe(
      false,
    );
    expect(
      credentialBacksNetwork(
        { ...credential, environment: "live" },
        now,
        "mainnet",
        live,
      ),
    ).toBe(true);
  });
});

describe("evidence signer separation", () => {
  it("rejects reusing the fee-quote signer for evidence", () => {
    const shared = Keypair.random().secret();
    expect(() =>
      assertEvidenceSignerSeparation({
        EVIDENCE_SIGNER_SECRET: shared,
        FEE_QUOTE_SIGNING_SECRET: shared,
      }),
    ).toThrow("must differ");
    expect(() =>
      assertEvidenceSignerSeparation({
        EVIDENCE_SIGNER_SECRET: Keypair.random().secret(),
        FEE_QUOTE_SIGNING_SECRET: shared,
      }),
    ).not.toThrow();
    expect(() =>
      assertEvidenceSignerSeparation({
        EVIDENCE_SIGNER_SECRET: "not-a-secret",
        FEE_QUOTE_SIGNING_SECRET: undefined,
      }),
    ).toThrow("not a valid");
  });
});
