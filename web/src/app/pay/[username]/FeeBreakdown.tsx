import { fromBaseUnits } from "../../../lib/crypto";

const usdc = (value: string) => `${fromBaseUnits(BigInt(value))} USDC`;

export function FeeBreakdown({
  previewing,
  preview,
}: {
  previewing: boolean;
  preview: {
    paymentAmount: string;
    feeBps: number;
    feeAmount: string;
    totalAmount: string;
  } | null;
}) {
  if (previewing) {
    return (
      <p
        className="text-[0.8125rem] leading-[1.1875rem] text-brand-linen/70"
        role="status"
        aria-live="polite"
      >
        Checking the recipient’s fee…
      </p>
    );
  }
  if (!preview) return null;

  const rows = [
    ["Payment amount", usdc(preview.paymentAmount)],
    [`Olio service fee (${preview.feeBps / 100}%)`, usdc(preview.feeAmount)],
    ["Recipient receives", usdc(preview.paymentAmount)],
  ];

  return (
    <dl
      className="grid divide-y divide-brand-linen/15 text-[0.8125rem] leading-[1.125rem]"
      aria-label="Payment breakdown"
      aria-live="polite"
      aria-atomic="true"
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-center justify-between gap-4 py-2"
        >
          <dt className="text-brand-linen/70">{label}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 pt-3">
        <dt className="font-semibold">Total</dt>
        <dd className="text-2xl leading-[1.875rem] font-semibold tracking-[-0.0125em] tabular-nums">
          {usdc(preview.totalAmount)}
        </dd>
      </div>
    </dl>
  );
}
