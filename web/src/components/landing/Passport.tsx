import { LandingSection } from "./LandingSection";

const KEPT_PRIVATE = ["Revenue", "Customers", "Balance"] as const;

const ON_PUBLIC_LINK = [
  "Verified by Olio",
  "Business name",
  "Status and validity",
] as const;

const LEDGER_ROWS = [
  { y: 140, label: 136, redaction: "M152 141L286 138" },
  { y: 184, label: 128, redaction: "M152 185L258 183" },
  { y: 228, label: 140, redaction: "M152 229L276 226" },
  { y: 272, label: 124, redaction: "M152 273L232 271" },
] as const;

export function Passport() {
  return (
    <LandingSection id="passport" aria-labelledby="passport-title">
      <div className="grid w-full gap-14 lg:grid-cols-12 lg:gap-x-6">
        <div className="max-md:text-center lg:col-span-5 lg:self-center">
          <h2
            className="type-landing-section-title mt-5 max-w-[16ch] text-balance text-ink max-md:mx-auto"
            id="passport-title"
          >
            Your business, verified, without publishing your books.
          </h2>
          <p className="mt-6 max-w-[40ch] text-[0.96rem] font-medium leading-[1.55] text-muted-text max-md:mx-auto">
            Once the service approves your business, or you as a sole
            proprietor, Olio issues an Identity Verified badge. Customers open
            its public link to confirm who they&apos;re paying.
          </p>

          <div className="mt-10 max-w-[40ch] border-t border-line-soft pt-6 max-md:mx-auto">
            <h3 className="text-[1.2rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
              Private until you publish it
            </h3>
            <p className="mt-3 text-[0.96rem] font-medium leading-[1.55] text-muted-text">
              The badge stays hidden until you choose to share it. Make it
              private again and the link stops confirming anything.
            </p>
          </div>
        </div>

        <div className="lg:col-span-7 lg:col-start-6">
          <div
            className="group/passport relative rounded-md bg-paper-2/70 px-3 py-8 transition-colors duration-300 hover:bg-paper-2 sm:px-8 sm:py-10"
            data-ed-article
          >
            <PassportSketch />
          </div>

          <div
            className="mt-8 grid border-t border-line-soft max-md:text-center sm:grid-cols-2"
            data-ed-article
          >
            <div className="pt-5 sm:pr-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-text">
                Kept private
              </h3>
              <ul className="mt-3 list-none divide-y divide-line-soft">
                {KEPT_PRIVATE.map((item) => (
                  <li
                    className="py-3 text-[0.96rem] font-medium text-muted-text"
                    key={item}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-line-soft pt-5 max-sm:mt-4 max-sm:border-t sm:border-l sm:pl-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-text">
                On the public link
              </h3>
              <ul className="mt-3 list-none divide-y divide-line-soft">
                {ON_PUBLIC_LINK.map((item) => (
                  <li
                    className="py-3 text-[0.96rem] font-medium text-ink"
                    key={item}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </LandingSection>
  );
}

function PassportSketch() {
  return (
    <svg
      className="h-auto w-full overflow-visible"
      viewBox="30 44 600 344"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g className="opacity-90" vectorEffect="non-scaling-stroke">
        <g transform="rotate(-3 320 214)">
          <rect
            x="72"
            y="68"
            width="496"
            height="290"
            rx="14"
            className="stroke-olive"
            strokeWidth="2"
          />
          <path
            d="M320 68C314 150 314 276 320 358"
            className="stroke-olive"
            strokeWidth="1.8"
          />
          <path
            d="M304 82C300 160 300 266 304 344M336 82C340 160 340 266 336 344"
            className="stroke-olive/25"
            strokeWidth="1.2"
          />
          <path
            d="M84 368C180 373 250 373 314 366M326 366C390 373 460 373 556 368"
            className="stroke-olive/40"
            strokeLinecap="round"
            strokeWidth="1.5"
          />

          <path
            d="M100 100H170"
            className="stroke-olive/55"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
          <path
            d="M100 114H296"
            className="stroke-olive/25"
            strokeWidth="1.2"
          />
          {LEDGER_ROWS.map((row) => (
            <g key={row.y} strokeLinecap="round">
              <path
                d={`M100 ${row.y}H${row.label}`}
                className="stroke-olive/55"
                strokeWidth="1.7"
              />
              <path
                d={row.redaction}
                className="stroke-olive/20"
                strokeWidth="12"
              />
            </g>
          ))}
          <path
            d="M100 320H296M100 334H262"
            className="stroke-olive/35"
            strokeDasharray="3 4"
            strokeWidth="1.4"
          />

          <path
            d="M344 100H420"
            className="stroke-olive/55"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
          <path
            d="M344 114H548"
            className="stroke-olive/25"
            strokeWidth="1.2"
          />
          <rect
            x="344"
            y="132"
            width="72"
            height="88"
            rx="8"
            className="stroke-olive"
            strokeWidth="2"
          />
          <circle
            cx="380"
            cy="164"
            r="13"
            className="stroke-olive/70"
            strokeWidth="1.8"
          />
          <path
            d="M358 206C361 192 370 186 380 186C390 186 399 192 402 206"
            className="stroke-olive/70"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <path
            d="M434 142H530"
            className="stroke-olive/75"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
          <path
            d="M434 166H508M434 190H520M434 214H486"
            className="stroke-olive/55"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
          <path
            d="M344 320H548M344 334H520"
            className="stroke-olive/35"
            strokeDasharray="3 4"
            strokeWidth="1.4"
          />
        </g>

        <path
          d="M600 118C620 168 610 214 578 240"
          className="stroke-gold/55 transition-transform duration-500 ease-out motion-safe:group-hover/passport:-translate-x-1 motion-safe:group-hover/passport:translate-y-1"
          strokeDasharray="6 9"
          strokeWidth="1.6"
        />
        <g className="transition-transform duration-500 ease-out motion-safe:group-hover/passport:-translate-x-1 motion-safe:group-hover/passport:translate-y-1">
          <g transform="rotate(-12 470 276)">
            <rect
              x="388"
              y="236"
              width="164"
              height="80"
              rx="16"
              className="stroke-gold"
              strokeDasharray="70 3 40 2 120 4 60 3"
              strokeWidth="2.6"
            />
            <rect
              x="398"
              y="246"
              width="144"
              height="60"
              rx="10"
              className="stroke-gold/60"
              strokeWidth="1.4"
            />
            <path
              d="M412 277L424 289L444 262"
              className="stroke-gold"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3.2"
            />
            <text
              x="456"
              y="284"
              className="fill-gold text-[16px] font-bold"
              lengthAdjust="spacingAndGlyphs"
              textLength="80"
            >
              VERIFIED
            </text>
            <path
              d="M456 296H520"
              className="stroke-gold/55"
              strokeLinecap="round"
              strokeWidth="1.4"
            />
          </g>
        </g>
        <path
          d="M556 206L566 192M570 226L588 220"
          className="stroke-olive/45"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
        <circle
          cx="606"
          cy="84"
          r="10"
          className="stroke-olive/45"
          strokeWidth="1.4"
        />
      </g>
    </svg>
  );
}
