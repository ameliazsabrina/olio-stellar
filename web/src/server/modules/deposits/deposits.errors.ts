// Written to indexer_state.lastError by a sync that succeeded but degraded.
// Payment readiness matches the gap message to tell a pure retention gap
// (non-blocking) from a sync error (blocking), so keep these shared.
export const POOL_INDEXER_GAP_MESSAGE =
  "Retention gap skipped a ledger window; some spent notes may be missing from the mirror until a full resync.";
export const POOL_INDEXER_ROOT_MESSAGE =
  "Mirrored pool root does not match the contract; evidence issuance is halted until the mirror is rebuilt.";

export class DepositIndexGapError extends Error {
  constructor(onChainCount: number, mirroredCount: number) {
    super(
      `deposit index gap detected: on-chain leaf_count=${onChainCount}, mirrored=${mirroredCount}`,
    );
    this.name = "DepositIndexGapError";
  }
}

export class PoolConfigurationMismatchError extends Error {
  constructor(indexedPoolId: string, configuredPoolId: string) {
    super(
      `pool configuration mismatch: database is scoped to ${indexedPoolId}, application is configured for ${configuredPoolId}; use an isolated database or complete an explicit scoped migration`,
    );
    this.name = "PoolConfigurationMismatchError";
  }
}
