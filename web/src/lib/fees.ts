export const OLIO_BPS_DENOMINATOR = 10_000n;
export const OLIO_DEFAULT_FEE_BPS = 200 as const;
export const OLIO_SPECIAL_FEE_BPS = 500 as const;
export const OLIO_FEE_POLICY_VERSION = 2 as const;
export const OLIO_FEE_QUOTE_FORMAT_VERSION = 1 as const;
export const DIRECT_QUOTE_LIFETIME_SECONDS = 15 * 60;
export const ASYNC_QUOTE_LIFETIME_SECONDS = 24 * 60 * 60;
export const MAX_NOTE_AMOUNT = (1n << 64n) - 1n;

export type FeeBps = 200 | 500;

export type FeeBreakdown = {
  paymentAmount: bigint;
  feeBps: FeeBps;
  feeAmount: bigint;
  totalAmount: bigint;
  policyVersion: typeof OLIO_FEE_POLICY_VERSION;
};

export function isAllowedFeeBps(value: number): value is FeeBps {
  return value === OLIO_DEFAULT_FEE_BPS || value === OLIO_SPECIAL_FEE_BPS;
}

export function quoteOlioFee(
  paymentAmount: bigint,
  feeBps: FeeBps,
): FeeBreakdown {
  if (paymentAmount <= 0n || paymentAmount > MAX_NOTE_AMOUNT) {
    throw new RangeError("Payment amount is outside the supported range.");
  }
  if (!isAllowedFeeBps(feeBps)) {
    throw new RangeError("Unsupported Olio fee rate.");
  }
  const feeAmount = (paymentAmount * BigInt(feeBps)) / OLIO_BPS_DENOMINATOR;
  return {
    paymentAmount,
    feeBps,
    feeAmount,
    totalAmount: paymentAmount + feeAmount,
    policyVersion: OLIO_FEE_POLICY_VERSION,
  };
}

/** Stellar USDC has 7 decimals while CCTP source USDC has 6. */
export function isCctpRepresentable(stellarBaseUnits: bigint): boolean {
  return stellarBaseUnits > 0n && stellarBaseUnits % 10n === 0n;
}

export function assertCctpQuoteRepresentable(quote: FeeBreakdown): void {
  if (
    !isCctpRepresentable(quote.paymentAmount) ||
    !isCctpRepresentable(quote.totalAmount)
  ) {
    throw new RangeError(
      "This amount cannot be paid cross-chain exactly. Use no more than 6 decimals and choose an amount whose fee is also representable.",
    );
  }
}
