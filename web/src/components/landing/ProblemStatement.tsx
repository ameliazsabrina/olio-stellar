import { ScrollReveal } from "./ScrollReveal";

export function ProblemStatement() {
  return (
    <section
      className="relative z-20 flex min-h-svh items-center bg-paper px-[clamp(20px,5vw,72px)] py-24 text-ink sm:py-28"
      id="problem"
      data-ed-section
      aria-labelledby="problem-title"
    >
      <h2 className="sr-only" id="problem-title">
        Public wallets were never designed for your business.
      </h2>
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[0.88fr_1fr] lg:gap-20">
        <div
          className="relative min-h-[220px] lg:min-h-[420px]"
          aria-hidden="true"
        >
          <LedgerSketch />
        </div>

        <div className="max-w-[620px] lg:justify-self-end">
          <ScrollReveal
            containerClassName="max-w-lg"
            textClassName="text-[clamp(1.8rem,4vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-ink"
            baseRotation={0}
            blurStrength={3}
            rotationEnd="center center"
            wordAnimationEnd="center center"
          >
            Public wallets were never designed for your business.
          </ScrollReveal>

          <div className="mt-10 space-y-7 text-[clamp(1.05rem,1.55vw,1.35rem)] font-medium leading-[1.38] text-ink/88">
            <ScrollReveal
              textClassName="max-w-[31ch]"
              baseRotation={1.6}
              baseOpacity={0.18}
              blurStrength={2}
              rotationEnd="center center"
              wordAnimationEnd="center center"
            >
              Every time someone pays your wallet, they can potentially see how
              <span className="font-bold text-olive-deep">
                {" "}
                much you earn, who else pays you, and your entire payment
                history.
              </span>
            </ScrollReveal>
            <ScrollReveal
              textClassName="max-w-[34ch]"
              baseRotation={1.4}
              baseOpacity={0.18}
              blurStrength={2}
              rotationEnd="center center"
              wordAnimationEnd="center center"
            >
              Using a different wallet every time only works until funds are
              consolidated.
            </ScrollReveal>

            <ScrollReveal
              textClassName="max-w-[29ch] text-olive-deep"
              baseRotation={1.4}
              baseOpacity={0.2}
              blurStrength={2}
              rotationEnd="center center"
              wordAnimationEnd="center center"
            >
              Privacy shouldn't require hiding from everyone.
            </ScrollReveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function LedgerSketch() {
  return (
    <svg
      className="absolute left-1/2 top-1/2 h-[min(62vw,500px)] w-[min(78vw,640px)] -translate-x-1/2 -translate-y-1/2 overflow-visible text-olive lg:left-[44%]"
      viewBox="0 0 640 500"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Decorative public ledger sketch</title>
      <g className="opacity-85" vectorEffect="non-scaling-stroke">
        <path
          d="M92 275C164 208 247 173 341 169C429 166 493 195 556 254"
          className="stroke-gold/70"
          strokeWidth="2"
          strokeDasharray="7 10"
        />
        <path
          d="M118 345C195 279 278 247 367 249C446 251 508 282 558 337"
          className="stroke-olive/35"
          strokeWidth="1.5"
          strokeDasharray="5 12"
        />
        <rect
          x="224"
          y="148"
          width="190"
          height="190"
          rx="22"
          className="stroke-olive"
          strokeWidth="2.2"
          transform="rotate(-17 319 243)"
        />
        <rect
          x="259"
          y="183"
          width="120"
          height="120"
          rx="18"
          className="stroke-olive/70"
          strokeWidth="1.8"
          transform="rotate(-17 319 243)"
        />
        <g className="stroke-gold" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="320" cy="236" r="43" strokeWidth="2" />
          <path d="M279 250L365 205" strokeWidth="9" className="stroke-paper" />
          <path d="M273 253L370 202" strokeWidth="2.8" />
          <path d="M270 271L367 220" strokeWidth="2.8" />
          <path
            d="M285 267A43 43 0 0 0 363 230"
            strokeWidth="2"
            className="stroke-gold/65"
          />
        </g>
        <circle
          cx="159"
          cy="275"
          r="42"
          className="stroke-olive"
          strokeWidth="2"
        />
        <circle
          cx="159"
          cy="275"
          r="16"
          className="stroke-gold"
          strokeWidth="2"
        />
        <circle
          cx="498"
          cy="256"
          r="47"
          className="stroke-olive"
          strokeWidth="2"
        />
        <circle
          cx="498"
          cy="256"
          r="18"
          className="stroke-gold"
          strokeWidth="2"
        />
        <circle
          cx="533"
          cy="359"
          r="30"
          className="stroke-olive/70"
          strokeWidth="1.8"
        />
        <circle
          cx="100"
          cy="354"
          r="28"
          className="stroke-olive/70"
          strokeWidth="1.8"
        />
        <path
          d="M159 275L270 224M374 229L498 256M356 284L533 359M260 278L100 354"
          className="stroke-olive/45"
          strokeWidth="1.6"
        />
        <g className="stroke-olive/55" strokeWidth="1.2">
          <path d="M235 151L203 108" />
          <path d="M286 136L277 78" />
          <path d="M346 136L366 81" />
          <path d="M405 159L451 118" />
          <path d="M424 214L488 205" />
          <path d="M417 282L475 314" />
          <path d="M356 341L378 397" />
          <path d="M290 345L269 400" />
          <path d="M229 315L177 352" />
        </g>
      </g>
    </svg>
  );
}
