import "server-only";
import { poolId, stellarNetwork } from "../../../lib/stellar";
import {
  getBusinessProfiles,
  getIdentityCredentials,
  getIndexerState,
  type IdentityCredentialDoc,
  type IndexerStateDoc,
} from "../../db/mongo";
import {
  credentialEnvironmentAllowed,
  verificationConfig,
} from "../verification/verification.config";
import { credentialIsCurrent } from "../verification/verification.policy";
import {
  type EvidenceConfig,
  evidenceConfig,
  evidenceNetworkMatches,
} from "./evidence.config";

export type GateReason =
  | "evidence_disabled"
  | "network_mismatch"
  | "signer_missing"
  | "signer_conflict"
  | "anchor_missing"
  | "pool_index_unpublished"
  | "pool_index_degraded"
  | "nullifiers_incomplete"
  | "pool_roots_mismatch"
  | "pool_roots_unverified"
  | "reconcile_behind"
  | "reconcile_degraded";

export type IssuanceGate = { open: boolean; reasons: GateReason[] };

export function evaluateIssuanceGate(input: {
  config: EvidenceConfig;
  pool: IndexerStateDoc | null;
  settlements: IndexerStateDoc | null;
}): IssuanceGate {
  const reasons: GateReason[] = [];
  const { config, pool, settlements } = input;
  if (config.mode === "off") reasons.push("evidence_disabled");
  else if (!evidenceNetworkMatches(config)) reasons.push("network_mismatch");
  if (!config.signerPublicKey || !config.keyId) reasons.push("signer_missing");
  if (!config.anchorPublicKey) reasons.push("anchor_missing");
  if (
    !pool ||
    pool.poolId !== poolId ||
    pool.publishedLeafIndex === undefined
  ) {
    reasons.push("pool_index_unpublished");
  } else {
    if (pool.health === "degraded") reasons.push("pool_index_degraded");
    if (pool.nullifiersComplete === false)
      reasons.push("nullifiers_incomplete");
    if (pool.rootsMismatch) reasons.push("pool_roots_mismatch");
    else if (
      !pool.rootsVerifiedAt ||
      pool.rootLeafCount !== pool.publishedLeafIndex + 1
    )
      reasons.push("pool_roots_unverified");
    if ((settlements?.lastLeafIndex ?? -1) < pool.publishedLeafIndex)
      reasons.push("reconcile_behind");
  }
  if (settlements?.health === "degraded") reasons.push("reconcile_degraded");
  return { open: reasons.length === 0, reasons };
}

export async function issuanceGate(
  config = evidenceConfig(),
): Promise<IssuanceGate> {
  const states = await getIndexerState();
  const [pool, settlements] = await Promise.all([
    states.findOne({ _id: "pool" }),
    states.findOne({ _id: "settlements" }),
  ]);
  return evaluateIssuanceGate({ config, pool, settlements });
}

export function credentialBacksNetwork(
  credential: IdentityCredentialDoc | null,
  now: Date,
  network = stellarNetwork,
  config = verificationConfig(),
): credential is IdentityCredentialDoc {
  return Boolean(
    credential &&
      credentialIsCurrent(credential, now) &&
      credentialEnvironmentAllowed(credential.environment, config) &&
      (network !== "mainnet" || credential.environment === "live"),
  );
}

export async function businessEvidenceAllowed(
  businessId: string,
  now = new Date(),
): Promise<boolean> {
  const config = verificationConfig();
  if (!config.environment) return false;
  const [business, credential] = await Promise.all([
    (await getBusinessProfiles()).findOne({ _id: businessId }),
    (await getIdentityCredentials()).findOne({
      businessId,
      environment: config.environment,
    }),
  ]);
  return (
    business?.lifecycle === "active" &&
    credentialBacksNetwork(credential, now, stellarNetwork, config)
  );
}
