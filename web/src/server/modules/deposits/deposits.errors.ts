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
