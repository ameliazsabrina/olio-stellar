export class DepositIndexGapError extends Error {
  constructor(onChainCount: number, mirroredCount: number) {
    super(`deposit index gap detected: on-chain leaf_count=${onChainCount}, mirrored=${mirroredCount}`);
    this.name = "DepositIndexGapError";
  }
}
