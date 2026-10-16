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

export type RecordsReason =
  | "pool_index_unpublished"
  | "pool_index_degraded"
  | "nullifiers_incomplete"
  | "pool_roots_mismatch"
  | "pool_roots_unverified"
  | "reconcile_behind"
  | "reconcile_degraded";

export type GateReason =
  | "evidence_disabled"
  | "network_mismatch"
  | "signer_missing"
  | "signer_conflict"
  | "anchor_missing"
  | RecordsReason;

export type IssuanceGate = { open: boolean; reasons: GateReason[] };

/**
 * Whether the settlement ledger mirrors every published pool deposit, and
 * when the pool index was last published. `asOf` is null until it has been.
 */
export type RecordsGate = {
  open: boolean;
  reasons: RecordsReason[];
  asOf: Date | null;
};

export function evaluateRecordsGate(input: {
  pool: IndexerStateDoc | null;
  settlements: IndexerStateDoc | null;
}): RecordsGate {
  const reasons: RecordsReason[] = [];
  const { pool, settlements } = input;
  const published = pool?.poolId === poolId ? pool : null;
  const leafIndex = published?.publishedLeafIndex;
  if (!published || leafIndex === undefined) {
    reasons.push("pool_index_unpublished");
  } else {
    if (published.health === "degraded") reasons.push("pool_index_degraded");
    if (published.nullifiersComplete === false)
      reasons.push("nullifiers_incomplete");
    if (published.rootsMismatch) reasons.push("pool_roots_mismatch");
    else if (
      !published.rootsVerifiedAt ||
      published.rootLeafCount !== leafIndex + 1
    )
      reasons.push("pool_roots_unverified");
    if ((settlements?.lastLeafIndex ?? -1) < leafIndex)
      reasons.push("reconcile_behind");
  }
  if (settlements?.health === "degraded") reasons.push("reconcile_degraded");
  return {
    open: reasons.length === 0,
    reasons,
    asOf:
      published && leafIndex !== undefined
        ? (published.indexedAt ?? published.updatedAt)
        : null,
  };
}

export function evaluateIssuanceGate(input: {
  config: EvidenceConfig;
  pool: IndexerStateDoc | null;
  settlements: IndexerStateDoc | null;
}): IssuanceGate {
  const reasons: GateReason[] = [];
  const { config } = input;
  if (config.mode === "off") reasons.push("evidence_disabled");
  else if (!evidenceNetworkMatches(config)) reasons.push("network_mismatch");
  if (!config.signerPublicKey || !config.keyId) reasons.push("signer_missing");
  if (!config.anchorPublicKey) reasons.push("anchor_missing");
  reasons.push(...evaluateRecordsGate(input).reasons);
  return { open: reasons.length === 0, reasons };
}

async function indexerStates() {
  const states = await getIndexerState();
  const [pool, settlements] = await Promise.all([
    states.findOne({ _id: "pool" }),
    states.findOne({ _id: "settlements" }),
  ]);
  return { pool, settlements };
}

export async function recordsGate(): Promise<RecordsGate> {
  return evaluateRecordsGate(await indexerStates());
}

export async function issuanceGate(
  config = evidenceConfig(),
): Promise<IssuanceGate> {
  return evaluateIssuanceGate({ config, ...(await indexerStates()) });
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
