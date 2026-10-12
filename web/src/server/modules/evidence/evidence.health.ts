import "server-only";
import { env } from "../../../env";
import { getIndexerState } from "../../db/mongo";
import { evidenceConfig } from "./evidence.config";
import { issuanceGate } from "./evidence.gate";
import { latestEpoch } from "./evidence.service";

const ANCHOR_LOW_BALANCE_XLM = 5;
const HORIZON_TIMEOUT_MS = 5_000;

export async function anchorBalanceXlm(
  account: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const base = env.NEXT_PUBLIC_STELLAR_HORIZON_URL.replace(/\/$/, "");
    const response = await fetchImpl(`${base}/accounts/${account}`, {
      signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      balances?: { asset_type?: string; balance?: string }[];
    };
    const native = body.balances?.find((b) => b.asset_type === "native");
    const balance = Number(native?.balance);
    return Number.isFinite(balance) ? balance : null;
  } catch {
    return null;
  }
}

export type EvidenceHealth = {
  status: "disabled" | "healthy" | "degraded";
  mode: "off" | "testnet" | "mainnet";
  keyId: string | null;
  lastRunAt: string | null;
  lastEpoch: {
    epoch: number;
    issuedAt: string;
    anchorState: "pending" | "submitted" | "confirmed";
  } | null;
  anchor: { configured: boolean; balanceLow: boolean | null };
  degradedReasons: string[];
};

export async function evidenceHealth(): Promise<EvidenceHealth> {
  const config = evidenceConfig();
  if (config.mode === "off") {
    return {
      status: "disabled",
      mode: config.mode,
      keyId: config.keyId,
      lastRunAt: null,
      lastEpoch: null,
      anchor: { configured: Boolean(config.anchorPublicKey), balanceLow: null },
      degradedReasons: [],
    };
  }
  const [gate, state, epoch, balance] = await Promise.all([
    issuanceGate(config),
    (await getIndexerState()).findOne({ _id: "evidence" }),
    latestEpoch(),
    config.anchorPublicKey
      ? anchorBalanceXlm(config.anchorPublicKey)
      : Promise.resolve(null),
  ]);
  const reasons: string[] = [...gate.reasons];
  if (state?.degradedReasons?.includes("signer_conflict"))
    reasons.push("signer_conflict");
  const balanceLow = balance === null ? null : balance < ANCHOR_LOW_BALANCE_XLM;
  if (config.anchorPublicKey && balance === null)
    reasons.push("anchor_balance_unknown");
  if (balanceLow) reasons.push("anchor_balance_low");
  return {
    status: reasons.length ? "degraded" : "healthy",
    mode: config.mode,
    keyId: config.keyId,
    lastRunAt: state?.lastRunAt?.toISOString() ?? null,
    lastEpoch: epoch
      ? {
          epoch: epoch.epoch,
          issuedAt: epoch.issuedAt.toISOString(),
          anchorState: epoch.anchorState,
        }
      : null,
    anchor: { configured: Boolean(config.anchorPublicKey), balanceLow },
    degradedReasons: reasons,
  };
}
