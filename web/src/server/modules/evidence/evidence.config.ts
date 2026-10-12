import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { getServerEnv } from "../../../env.server";
import { stellarNetwork } from "../../../lib/stellar";

export const EVIDENCE_SIGNING_DOMAIN = "OLIO_EVIDENCE_V1";

export type EvidenceConfig = {
  mode: "off" | "testnet" | "mainnet";
  keyId: string | null;
  signerPublicKey: string | null;
  anchorPublicKey: string | null;
  intervalSeconds: number;
  policyVersion: number;
  manifestTtlDays: number;
};

function publicKeyOf(secret: string | undefined): string | null {
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return null;
  }
}

export function evidenceConfig(): EvidenceConfig {
  const env = getServerEnv();
  return {
    mode: env.EVIDENCE_MODE,
    keyId: env.EVIDENCE_SIGNER_KEY_ID ?? null,
    signerPublicKey: publicKeyOf(env.EVIDENCE_SIGNER_SECRET),
    anchorPublicKey: publicKeyOf(env.EVIDENCE_ANCHOR_SECRET),
    intervalSeconds: env.EVIDENCE_EPOCH_INTERVAL_SECONDS,
    policyVersion: env.EVIDENCE_POLICY_VERSION,
    manifestTtlDays: env.EVIDENCE_MANIFEST_TTL_DAYS,
  };
}

export function evidenceNetworkMatches(config: EvidenceConfig): boolean {
  return config.mode !== "off" && config.mode === stellarNetwork;
}
