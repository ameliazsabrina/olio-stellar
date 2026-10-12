import "server-only";
import { randomUUID } from "node:crypto";
import { poolId, stellarNetwork } from "../../../lib/stellar";
import {
  type EvidenceEpochDoc,
  type EvidenceKeyDoc,
  getEvidenceEpochs,
  getEvidenceKeys,
  getIndexerState,
} from "../../db/mongo";
import { acquireStateLease, releaseStateLease } from "../../lib/stateLease";
import { type EvidenceConfig, evidenceConfig } from "./evidence.config";
import { type GateReason, issuanceGate } from "./evidence.gate";

const LEASE_MS = 50_000;

export type EvidenceRunResult = {
  status: "disabled" | "skipped" | "halted" | "ready";
  reasons: GateReason[];
  durationMs: number;
};

export async function registerSigningKey(
  config: EvidenceConfig,
  now = new Date(),
): Promise<boolean> {
  if (!config.keyId || !config.signerPublicKey) return true;
  const keys = await getEvidenceKeys();
  const existing = await keys.findOne({ _id: config.keyId });
  if (existing) return existing.publicKey === config.signerPublicKey;
  try {
    await keys.insertOne({
      _id: config.keyId,
      publicKey: config.signerPublicKey,
      validFrom: now,
      validTo: null,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await keys.findOne({ _id: config.keyId });
    return raced?.publicKey === config.signerPublicKey;
  }
  await keys.updateMany(
    { _id: { $ne: config.keyId }, validTo: null },
    { $set: { validTo: now } },
  );
  return true;
}

export async function runEvidenceEpoch(): Promise<EvidenceRunResult> {
  const startedAt = Date.now();
  const config = evidenceConfig();
  if (config.mode === "off") {
    return {
      status: "disabled",
      reasons: ["evidence_disabled"],
      durationMs: 0,
    };
  }
  const owner = randomUUID();
  if (!(await acquireStateLease("evidence", owner, LEASE_MS))) {
    return {
      status: "skipped",
      reasons: [],
      durationMs: Date.now() - startedAt,
    };
  }
  try {
    const keyOk = await registerSigningKey(config);
    const gate = await issuanceGate(config);
    const reasons: GateReason[] = keyOk
      ? gate.reasons
      : [...gate.reasons, "signer_conflict"];
    const now = new Date();
    await (await getIndexerState()).updateOne(
      { _id: "evidence", leaseOwner: owner },
      {
        $set: {
          poolId,
          lastRunAt: now,
          updatedAt: now,
          health: reasons.length ? "degraded" : "healthy",
          degradedReasons: reasons,
        },
      },
    );
    return {
      status: reasons.length ? "halted" : "ready",
      reasons,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await releaseStateLease("evidence", owner);
  }
}

export async function publishedEvidenceKeys(): Promise<EvidenceKeyDoc[]> {
  return (await getEvidenceKeys()).find({}).sort({ validFrom: 1 }).toArray();
}

export async function latestEpoch(): Promise<EvidenceEpochDoc | null> {
  return (await getEvidenceEpochs()).findOne(
    { network: stellarNetwork, poolId },
    { sort: { epoch: -1 } },
  );
}
