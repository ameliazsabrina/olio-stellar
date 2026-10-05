import { rpc } from "@stellar/stellar-sdk";

export const PREPARED_TX_STALE_MS = 3 * 60_000;

export type PreparedTransactionResolution =
  | "success"
  | "failed"
  | "stale"
  | "pending";

export function preparedTransactionResolution(
  status: rpc.Api.GetTransactionStatus,
  preparedAt: Date | undefined,
  nowMs = Date.now(),
): PreparedTransactionResolution {
  if (status === rpc.Api.GetTransactionStatus.SUCCESS) return "success";
  if (status === rpc.Api.GetTransactionStatus.FAILED) return "failed";
  // NOT_FOUND may mean RPC retention or an outage, even after the timebound.
  // Preserve the checkpoint until chain execution/replay evidence resolves it.
  void preparedAt;
  void nowMs;
  return "pending";
}

export function burnWasAuthorized(
  burnedAtSeconds: number,
  quoteExpiresAt: bigint,
): boolean {
  return (
    Number.isSafeInteger(burnedAtSeconds) &&
    burnedAtSeconds >= 0 &&
    BigInt(burnedAtSeconds) <= quoteExpiresAt
  );
}

// A missing result is conclusive only when this RPC covers the entire signed
// validity interval and has ingested ledgers beyond its actual maxTime.
export function missingTransactionProvenExpired(
  response: { status: rpc.Api.GetTransactionStatus; oldestLedgerCloseTime: number; latestLedgerCloseTime: number },
  bounds?: { minTime: number; maxTime: number },
): boolean {
  return response.status === rpc.Api.GetTransactionStatus.NOT_FOUND && !!bounds &&
    Number.isSafeInteger(bounds.minTime) && Number.isSafeInteger(bounds.maxTime) &&
    bounds.minTime > 0 && bounds.maxTime > bounds.minTime &&
    response.oldestLedgerCloseTime <= bounds.minTime && response.latestLedgerCloseTime > bounds.maxTime;
}
