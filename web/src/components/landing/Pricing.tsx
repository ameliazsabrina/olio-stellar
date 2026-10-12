import { cn } from "@/lib/utils";

import { LandingSection } from "./LandingSection";

const RECEIPT = [
  { label: "Invoice", amount: "100.00", operator: null },
  { label: "Service fee", amount: "2.00", operator: "+" },
  { label: "Your customer pays", amount: "102.00", operator: "=" },
  { label: "You receive", amount: "100.00", operator: null, emphasis: true },
] as const;

export function Pricing() {
  return (
    <LandingSection
      tone="transparent"
      spacing="compact"
      className="bg-paper-2 text-ink"
      id="pricing"
      aria-labelledby="pricing-title"
    >
      <h2
        className="type-landing-section-title mx-auto max-w-[20ch] text-balance text-center text-ink"
        id="pricing-title"
      >
        A flat{" "}
        <span className="relative inline-block whitespace-nowrap text-olive-deep">
          2%
          <FeeUnderline />
        </span>{" "}
        service fee, added on top and paid by your customer.
      </h2>

      <div className="relative mt-14 border-t border-line-soft" data-ed-article>
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 h-3 bg-[repeating-linear-gradient(to_right,rgba(32,38,26,0.08)_0,rgba(32,38,26,0.08)_1px,transparent_1px,transparent_8px)]"
          aria-hidden="true"
        />
        <dl className="grid grid-cols-2 md:grid-cols-4">
          {RECEIPT.map((row, index) => (
            <div
              className={cn(
                "relative border-line-soft pb-2 pt-8 md:pr-6",
                index % 2 === 1 && "border-l pl-5 md:pl-6",
                index === 2 && "md:border-l md:pl-6",
                index >= 2 && "max-md:mt-6 max-md:border-t",
              )}
              key={row.label}
            >
              {row.operator ? (
                <span
                  className="absolute -left-[0.4em] top-[2.15rem] hidden bg-paper-2 px-1 text-[1.2rem] font-semibold leading-none text-gold md:block"
                  aria-hidden="true"
                >
                  {row.operator}
                </span>
              ) : null}
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-text">
                {row.label}
              </dt>
              <dd className="mt-3 text-[clamp(1.6rem,2.6vw,2.3rem)] font-semibold leading-none tracking-[-0.035em] text-ink tabular-nums">
                {/* Ledger convention: a double rule marks the line that matters. */}
                <span
                  className={cn(
                    "emphasis" in row &&
                      row.emphasis &&
                      "border-b-[3px] border-double border-olive pb-1",
                  )}
                >
                  {row.amount}
                </span>
                <span className="ml-1.5 text-[0.9rem] font-semibold tracking-normal text-muted-text">
                  USDC
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </LandingSection>
  );
}

// A single hand-drawn gold stroke, same vocabulary as the Steps sketches.
function FeeUnderline() {
  return (
    <svg
      className="pointer-events-none absolute -bottom-[0.02em] left-[-4%] h-[0.12em] w-[108%] overflow-visible"
      viewBox="0 0 120 12"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8.5C28 4.5 58 3.2 86 4.6C99 5.2 109 6.4 117 8"
        className="stroke-gold"
        strokeLinecap="round"
        strokeWidth="2.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
