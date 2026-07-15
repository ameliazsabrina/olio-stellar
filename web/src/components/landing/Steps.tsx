const STEPS = [
  {
    number: "1",
    title: "Share a payment link",
    body: "Create a payment request in seconds and send it like any normal invoice.",
    sketch: "link",
  },
  {
    number: "2",
    title: "Get paid in USDC",
    body: "Your client pays normally using supported stablecoin rails.",
    sketch: "usdc",
  },
  {
    number: "3",
    title: "Keep your payment private",
    body: "Your receipt is stored privately, not exposed on a public wallet for everyone to inspect.",
    sketch: "private",
  },
] as const;

type StepSketchName = (typeof STEPS)[number]["sketch"];

export function Steps() {
  return (
    <section
      className="relative z-20 bg-paper px-[clamp(20px,5vw,72px)] py-16 text-ink sm:py-24"
      id="steps"
      aria-labelledby="steps-title"
    >
      <div className="mx-auto w-full max-w-7xl lg:px-12 lg:py-16">
        <div className="mx-auto max-w-[680px] text-center">
          <h2
            className="text-balance text-[clamp(2.3rem,5vw,4rem)] font-semibold leading-[0.96] tracking-[-0.04em] text-ink"
            id="steps-title"
          >
            Three simple steps.
          </h2>
        </div>

        <div className="relative mt-12 grid border-line-soft md:grid-cols-3 md:border-t">
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 hidden h-3 bg-[repeating-linear-gradient(to_right,rgba(32,38,26,0.08)_0,rgba(32,38,26,0.08)_1px,transparent_1px,transparent_8px)] md:block"
            aria-hidden="true"
          />
          {STEPS.map((step) => (
            <article
              className="group/card relative flex min-h-[400px] flex-col border-line-soft py-7 transition-colors duration-300 hover:bg-paper/35 max-md:border-t md:px-6 md:[&:not(:first-child)]:border-l lg:px-8"
              key={step.number}
            >
              <span className="mb-10 inline-flex h-9 w-fit items-center justify-center rounded-md border border-line-soft bg-paper px-4 text-sm font-semibold text-ink/74 transition-colors duration-300 group-hover/card:border-olive/25 group-hover/card:text-olive-deep">
                Step {step.number}
              </span>

              <h3 className="max-w-[14ch] text-[1.2rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
                {step.title}
              </h3>

              <p className="mt-4 max-w-[29ch] text-[0.96rem] font-medium leading-[1.55] text-muted-text">
                {step.body}
              </p>

              <div className="relative mt-auto h-[172px] overflow-hidden rounded-md bg-paper-2/70 transition-colors duration-300 group-hover/card:bg-paper">
                <StepSketch name={step.sketch} />
              </div>
            </article>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-[780px] text-center text-balance text-[clamp(1.2rem,2.1vw,2rem)] font-medium leading-[1.16] tracking-[-0.03em] text-olive-deep">
          Whenever needed, generate proof for that specific payment without
          revealing everything else.
        </p>
      </div>
    </section>
  );
}

function StepSketch({ name }: { name: StepSketchName }) {
  return (
    <svg
      className="absolute left-1/2 top-1/2 h-[178px] w-[235px] -translate-x-1/2 -translate-y-1/2 overflow-visible text-olive transition-transform duration-500 ease-out motion-safe:group-hover/card:-rotate-2 motion-safe:group-hover/card:scale-[1.045]"
      viewBox="0 0 250 190"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {name === "link" && <PaymentLinkSketch />}
      {name === "usdc" && <UsdcSketch />}
      {name === "private" && <PrivateReceiptSketch />}
    </svg>
  );
}

function PaymentLinkSketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <path
        d="M38 130C74 93 112 78 151 86C181 92 202 111 218 139"
        className="stroke-gold/65 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-2 motion-safe:group-hover/card:-translate-y-1"
        strokeDasharray="6 9"
        strokeWidth="1.7"
      />
      <rect
        x="70"
        y="34"
        width="108"
        height="126"
        rx="14"
        className="stroke-olive"
        strokeWidth="2"
        transform="rotate(-6 124 97)"
      />
      <path
        d="M94 69L151 63M92 91L160 84M91 113L139 108"
        className="stroke-olive/55"
        strokeLinecap="round"
        strokeWidth="1.7"
        transform="rotate(-6 124 97)"
      />
      <g
        className="stroke-gold transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-2 motion-safe:group-hover/card:translate-x-2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      >
        <path d="M82 134L68 148C59 157 44 157 35 148C26 139 26 124 35 115L48 102" />
        <path d="M68 120L105 83" />
        <path d="M168 61L181 48C190 39 205 39 214 48C223 57 223 72 214 81L201 94" />
        <path d="M182 76L145 113" />
      </g>
      <circle
        cx="198"
        cy="131"
        r="15"
        className="stroke-olive/55 transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-x-2 motion-safe:group-hover/card:translate-y-2"
        strokeWidth="1.6"
      />
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

function UsdcSketch() {
  return (
    <g className="opacity-90" vectorEffect="non-scaling-stroke">
      <path
        d="M34 104C68 75 103 62 139 66C172 70 198 88 220 119"
        className="stroke-olive/35 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-2 motion-safe:group-hover/card:-translate-y-1"
        strokeDasharray="5 10"
        strokeWidth="1.6"
      />
      <path
        d="M39 139H211"
        className="stroke-olive/45"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <g
        className="stroke-olive transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-y-2"
        strokeWidth="2"
      >
        <rect x="47" y="112" width="36" height="27" rx="7" />
        <rect x="167" y="112" width="36" height="27" rx="7" />
      </g>
      <path
        d="M83 125H107M143 125H167"
        className="stroke-gold/70 transition-transform duration-500 ease-out motion-safe:group-hover/card:translate-x-2"
        strokeDasharray="4 7"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <g className="transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-3 motion-safe:group-hover/card:rotate-1">
        <circle
          cx="125"
          cy="97"
          r="44"
          className="stroke-gold"
          strokeWidth="2.2"
        />
        <circle
          cx="125"
          cy="97"
          r="29"
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
      <path
        d="M71 66L58 43M93 51L91 25M158 51L167 27M183 69L207 49"
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
