import { cn } from "@/lib/utils";

import { LandingSection } from "./LandingSection";

const PHASES = [
  { label: "Set up", span: 1 },
  { label: "Get paid", span: 3 },
  { label: "Prove", span: 1 },
] as const;

const STEPS = [
  {
    number: "1",
    phase: "Set up",
    title: "Verify your business",
    body: "A one-time check for your business, or for you as a sole proprietor, before your first payment.",
    sketch: "verify",
  },
  {
    number: "2",
    phase: "Get paid",
    title: "Issue an invoice",
    body: "Send an invoice, or share a payment link or QR code. Line items are encrypted in your browser.",
    sketch: "invoice",
  },
  {
    number: "3",
    phase: "Get paid",
    title: "Your customer pays",
    body: "In USDC from any chains. No Olio account needed.",
    sketch: "payin",
  },
  {
    number: "4",
    phase: "Get paid",
    title: "It settles privately",
    body: "The payment becomes a private note only you can read, matched to the invoice it paid.",
    sketch: "private",
  },
  {
    number: "5",
    phase: "Prove",
    title: "Prove it, cash out",
    body: "Disclose a single payment without revealing the others, then withdraw to a Stellar wallet.",
    sketch: "prove",
  },
] as const;

type StepSketchName = (typeof STEPS)[number]["sketch"];

export function Steps() {
  return (
    <LandingSection spacing="compact" id="steps" aria-labelledby="steps-title">
      <div className="w-full lg:px-12 lg:py-16 xl:px-0">
        <div className="mx-auto max-w-[680px] text-center">
          <h2
            className="type-landing-section-title text-balance text-ink"
            id="steps-title"
          >
            From invoice to proof, in five steps.
          </h2>
        </div>

        <div className="mt-12 hidden grid-cols-5 xl:grid">
          {PHASES.map((phase, index) => (
            <p
              className={cn(
                "px-5 pb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-text",
                phase.span === 3 && "col-span-3",
                index > 0 && "border-l border-line-soft",
              )}
              key={phase.label}
            >
              {phase.label}
            </p>
          ))}
        </div>

        <div className="relative mt-12 border-line-soft md:border-t xl:mt-0">
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 hidden h-3 bg-[repeating-linear-gradient(to_right,rgba(32,38,26,0.08)_0,rgba(32,38,26,0.08)_1px,transparent_1px,transparent_8px)] md:block"
            aria-hidden="true"
          />
          <ol className="grid list-none md:grid-cols-2 xl:grid-cols-5">
            {STEPS.map((step) => (
              <li
                className="group/card relative flex min-h-[400px] flex-col border-line-soft py-7 transition-colors duration-300 hover:bg-paper/35 max-md:border-t max-md:text-center md:px-6 md:even:border-l md:last:col-span-2 md:[&:nth-child(n+3)]:border-t xl:px-5 xl:last:col-span-1 xl:[&:not(:first-child)]:border-l xl:[&:nth-child(n+3)]:border-t-0"
                key={step.number}
              >
                <div className="mb-10 flex items-center gap-3 max-md:justify-center">
                  <span className="inline-flex h-9 w-fit items-center justify-center rounded-md border border-line-soft bg-paper px-4 text-sm font-semibold text-ink/74 transition-colors duration-300 group-hover/card:border-olive/25 group-hover/card:text-olive-deep">
                    Step {step.number}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-text xl:hidden">
                    {step.phase}
                  </span>
                </div>

                <h3 className="max-w-[14ch] text-[1.2rem] max-md:mx-auto font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
                  {step.title}
                </h3>

                <p className="mt-4 max-w-[29ch] text-[0.96rem] max-xl:mx-auto font-medium leading-[1.55] text-muted-text">
                  {step.body}
                </p>

                <div className="relative mt-auto h-[172px] overflow-hidden rounded-md bg-paper-2/70 transition-colors duration-300 group-hover/card:bg-paper max-md:mt-8">
                  <StepSketch name={step.sketch} />
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="mx-auto mt-12 max-w-[780px] text-center text-balance text-[clamp(1.2rem,2.1vw,2rem)] font-medium leading-[1.16] tracking-[-0.03em] text-olive-deep">
          Whenever needed, generate proof for that specific payment without
          revealing everything else.
        </p>
      </div>
    </LandingSection>
  );
}

function StepSketch({ name }: { name: StepSketchName }) {
  return (
    <svg
      className="absolute left-1/2 top-1/2 h-auto w-[min(235px,92%)] -translate-x-1/2 -translate-y-1/2 overflow-visible text-olive transition-transform duration-500 ease-out motion-safe:group-hover/card:-rotate-2 motion-safe:group-hover/card:scale-[1.045]"
      viewBox="0 0 250 190"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {name === "verify" && <VerifySketch />}
      {name === "invoice" && <InvoiceSketch />}
      {name === "payin" && <PayInSketch />}
      {name === "private" && <PrivateReceiptSketch />}
      {name === "prove" && <ProveSketch />}
    </svg>
  );
}

function VerifySketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <path
        d="M212 52C228 76 226 102 210 120"
        className="stroke-gold/55 transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-x-1 motion-safe:group-hover/card:translate-y-1"
        strokeDasharray="6 9"
        strokeWidth="1.6"
      />
      <g transform="rotate(-6 116 96)">
        <rect
          x="44"
          y="46"
          width="142"
          height="98"
          rx="13"
          className="stroke-olive"
          strokeWidth="2"
        />
        <circle
          cx="82"
          cy="84"
          r="13"
          className="stroke-olive/70"
          strokeWidth="1.8"
        />
        <path
          d="M62 122C65 109 74 103 82 103C90 103 99 109 102 122"
          className="stroke-olive/70"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <path
          d="M118 78H164M118 96H158M118 114H144"
          className="stroke-olive/50"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      </g>
      <g className="transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-x-1 motion-safe:group-hover/card:translate-y-1">
        <g transform="rotate(-12 178 134)">
          <circle
            cx="178"
            cy="134"
            r="35"
            className="stroke-gold/55"
            strokeDasharray="4 7"
            strokeWidth="1.6"
          />
          <circle
            cx="178"
            cy="134"
            r="26"
            className="stroke-gold"
            strokeWidth="2.2"
          />
          <path
            d="M166 134L175 143L192 124"
            className="stroke-gold"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.6"
          />
        </g>
      </g>
      <circle
        cx="38"
        cy="156"
        r="10"
        className="stroke-olive/45 transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2"
        strokeWidth="1.4"
      />
    </g>
  );
}

function InvoiceSketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <path
        d="M38 130C74 93 112 78 151 86C181 92 202 111 218 139"
        className="stroke-gold/65 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-2 motion-safe:group-hover/card:-translate-y-1"
        strokeDasharray="6 9"
        strokeWidth="1.7"
      />
      <g transform="rotate(-6 124 97)">
        <rect
          x="70"
          y="34"
          width="108"
          height="126"
          rx="14"
          className="stroke-olive"
          strokeWidth="2"
        />
        <path
          d="M92 58H124M92 76H156M92 94H148"
          className="stroke-olive/55"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <path
          d="M92 110H156"
          className="stroke-olive/30"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
        <path
          d="M92 128H120"
          className="stroke-gold"
          strokeLinecap="round"
          strokeWidth="2.4"
        />
        <g className="stroke-olive/60" strokeWidth="1.5">
          <rect x="136" y="120" width="26" height="26" rx="4" />
          <rect x="141" y="125" width="6" height="6" rx="1.5" />
          <rect x="151" y="125" width="6" height="6" rx="1.5" />
          <rect x="141" y="135" width="6" height="6" rx="1.5" />
          <path d="M152 137H157M152 141H155" strokeLinecap="round" />
        </g>
      </g>
      <g
        className="stroke-gold transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      >
        <path d="M82 134L68 148C59 157 44 157 35 148C26 139 26 124 35 115L48 102" />
        <path d="M68 120L84 104" />
        <path d="M168 61L181 48C190 39 205 39 214 48C223 57 223 72 214 81L201 94" />
        <path d="M182 76L166 92" />
      </g>
      <circle
        cx="46"
        cy="58"
        r="10"
        className="stroke-olive/45 transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2"
        strokeWidth="1.4"
      />
    </g>
  );
}

const PAY_IN_ORIGINS = [
  { cx: 40, cy: 146, path: "M46 142L98 120" },
  { cx: 72, cy: 158, path: "M77 153L107 127" },
  { cx: 107, cy: 164, path: "M109 157L118 130" },
  { cx: 143, cy: 164, path: "M141 157L132 130" },
  { cx: 178, cy: 158, path: "M173 153L143 127" },
  { cx: 210, cy: 146, path: "M204 142L152 120" },
] as const;

function PayInSketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <path
        d="M34 92C68 63 103 50 139 54C172 58 198 76 220 107"
        className="stroke-olive/35 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-2 motion-safe:group-hover/card:-translate-y-1"
        strokeDasharray="5 10"
        strokeWidth="1.6"
      />
      <g
        className="stroke-gold/70"
        strokeDasharray="4 6"
        strokeLinecap="round"
        strokeWidth="1.6"
      >
        {PAY_IN_ORIGINS.map((origin) => (
          <path d={origin.path} key={origin.path} />
        ))}
      </g>
      <g
        className="stroke-olive transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-y-1"
        strokeWidth="1.8"
      >
        {PAY_IN_ORIGINS.map((origin) => (
          <circle cx={origin.cx} cy={origin.cy} key={origin.cx} r="7" />
        ))}
      </g>
      <g className="transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-3 motion-safe:group-hover/card:rotate-1">
        <g transform="translate(0 -12)">
          <circle
            cx="125"
            cy="97"
            r="42"
            className="stroke-gold"
            strokeWidth="2.2"
          />
          <circle
            cx="125"
            cy="97"
            r="28"
            className="stroke-olive/70"
            strokeWidth="1.8"
          />
          <path
            d="M135 76C124 70 111 75 109 86C107 97 118 101 126 103C136 106 143 110 141 121C139 132 124 138 112 130M126 68V78M124 126V137"
            className="stroke-gold"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.3"
          />
        </g>
      </g>
      <path
        d="M71 54L58 31M93 39L91 13M158 39L167 15M183 57L207 37"
        className="stroke-olive/45"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </g>
  );
}

function PrivateReceiptSketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <path
        d="M45 142C87 113 127 103 166 111C189 116 205 127 219 145"
        className="stroke-gold/55 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-2 motion-safe:group-hover/card:-translate-y-1"
        strokeDasharray="7 10"
        strokeWidth="1.6"
      />
      <rect
        x="65"
        y="37"
        width="120"
        height="126"
        rx="15"
        className="stroke-olive"
        strokeWidth="2"
        transform="rotate(5 125 100)"
      />
      <path
        d="M89 72L151 78M87 95L163 102M86 119L136 124"
        className="stroke-olive/50"
        strokeLinecap="round"
        strokeWidth="1.7"
        transform="rotate(5 125 100)"
      />
      <path
        d="M157 121V105C157 87 169 76 185 76C201 76 213 87 213 105V121"
        className="stroke-gold transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-1"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <rect
        x="145"
        y="118"
        width="80"
        height="46"
        rx="11"
        className="stroke-gold transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-1"
        strokeWidth="2.4"
      />
      <path
        d="M185 136V148"
        className="stroke-gold transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-1"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <circle
        cx="185"
        cy="134"
        r="4"
        className="stroke-gold transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-1"
        strokeWidth="2"
      />
      <circle
        cx="49"
        cy="83"
        r="15"
        className="stroke-olive/45"
        strokeWidth="1.5"
      />
      <circle
        cx="209"
        cy="52"
        r="10"
        className="stroke-olive/45"
        strokeWidth="1.4"
      />
    </g>
  );
}

function ProveSketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <g transform="rotate(-5 111 98)">
        <rect
          x="50"
          y="34"
          width="122"
          height="128"
          rx="14"
          className="stroke-olive"
          strokeWidth="2"
        />
        <path
          d="M74 60H148M74 82H138M74 138H130"
          className="stroke-olive/20"
          strokeLinecap="round"
          strokeWidth="7"
        />
        <rect
          x="63"
          y="98"
          width="96"
          height="24"
          rx="7"
          className="stroke-gold"
          strokeWidth="2"
        />
        <path
          d="M74 110H110"
          className="stroke-olive/60"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <path
          d="M124 110H148"
          className="stroke-gold"
          strokeLinecap="round"
          strokeWidth="2.2"
        />
      </g>
      <path
        d="M166 106C182 100 194 106 200 120"
        className="stroke-gold/70 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-1"
        strokeDasharray="5 8"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <g className="transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-2">
        <rect
          x="180"
          y="122"
          width="48"
          height="36"
          rx="8"
          className="stroke-olive"
          strokeWidth="2"
        />
        <rect
          x="206"
          y="132"
          width="22"
          height="15"
          rx="5"
          className="stroke-olive/60"
          strokeWidth="1.6"
        />
        <circle
          cx="214"
          cy="139.5"
          r="2.5"
          className="stroke-gold"
          strokeWidth="2"
        />
      </g>
      <path
        d="M196 64L214 46M206 82L230 76"
        className="stroke-olive/45"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <circle
        cx="34"
        cy="150"
        r="11"
        className="stroke-olive/45 transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2"
        strokeWidth="1.4"
      />
    </g>
  );
}
