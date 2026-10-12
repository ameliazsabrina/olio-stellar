import Image from "next/image";

import { cn } from "@/lib/utils";

import { LandingSection } from "./LandingSection";

const USER_CARDS = [
  {
    title: "Service businesses",
    description:
      "Agencies and studios billing customers abroad. A design studio in Jakarta invoices a client in Berlin, and no other customer can look up what it charges.",
    eyebrow: "International customers",
    image: "/assets/agency.png",
    wide: true,
  },
  {
    title: "Sole proprietors",
    description:
      "Consultants, developers, and designers who run as a business. Verify as an individual and use the same invoices and proofs as a company.",
    eyebrow: "Independent professionals",
    image: "/assets/freelancer.png",
    wide: false,
  },
  {
    title: "Small businesses",
    description:
      "Each payment is matched to the invoice it paid, so your accountant, bank and tax office get answers without seeing the rest.",
    eyebrow: "Records, not just payments",
    image: "/assets/small-business.png",
    wide: false,
  },
] as const;

// Each quote spans two rows and the right column starts one row lower, so the
// boxes stagger like bricks. Margins and rotation (not translate) do the
// scattering, leaving transform free for the hover lift and scroll reveal.
const RECOGNITION_QUOTES = [
  {
    text: "I want to accept USDC without publishing my revenue.",
    scatter:
      "sm:col-start-1 sm:row-start-1 sm:mr-10 sm:-rotate-2 sm:justify-self-end",
  },
  {
    text: "I don't want customers seeing what other customers pay me.",
    scatter: "sm:col-start-2 sm:row-start-2 sm:rotate-1 sm:justify-self-start",
  },
  {
    text: "I need to show a bank or auditor that a payment happened.",
    scatter: "sm:col-start-1 sm:row-start-3 sm:rotate-1 sm:justify-self-end",
  },
  {
    text: "I don't want my team handling wallet addresses or network fees.",
    scatter:
      "sm:col-start-2 sm:row-start-4 sm:ml-12 sm:-rotate-1 sm:justify-self-start",
  },
] as const;

export function Users() {
  return (
    <LandingSection
      spacing="compact"
      id="users"
      data-ed-section
      aria-labelledby="users-title"
    >
      <div className="w-full">
        <div className="max-w-full">
          <h2
            className="type-landing-section-title max-w-[18ch] text-balance text-ink"
            id="users-title"
          >
            Built for businesses that bill in USDC.
          </h2>
        </div>

        <div className="mt-14 grid gap-1.5 md:grid-cols-2">
          {USER_CARDS.map((card) => (
            <article
              className={cn(
                "group relative min-h-[360px] overflow-hidden rounded-2xl bg-olive-deep text-ed-cream md:min-h-[390px] lg:min-h-[430px]",
                card.wide && "md:col-span-2",
              )}
              key={card.title}
            >
              <Image
                src={card.image}
                alt=""
                fill
                sizes={card.wide ? "100vw" : "(min-width: 768px) 50vw, 100vw"}
                className="object-cover"
              />
              <div
                className="absolute inset-0 bg-olive-deep/42 mix-blend-multiply"
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(245,243,234,0.18)_0_1px,transparent_1px_8px),linear-gradient(to_bottom,rgba(32,38,26,0.12),rgba(32,38,26,0.74))] opacity-80"
                aria-hidden="true"
              />

              <div className="relative flex min-h-[360px] flex-col justify-between p-7 md:min-h-[390px] lg:min-h-[430px] lg:p-8">
                <p className="text-xs font-semibold tracking-[0.12em] text-ed-cream/78">
                  {card.eyebrow}
                </p>

                <div className={card.wide ? "max-w-[520px]" : "max-w-[360px]"}>
                  <h3 className="text-balance text-[clamp(2rem,3.2vw,3.35rem)] font-semibold leading-[0.92] tracking-[-0.045em] text-ed-cream">
                    {card.title}
                  </h3>
                  <p
                    className={cn(
                      "mt-4 text-base font-medium leading-[1.45] text-ed-cream/82",
                      card.wide ? "max-w-[44ch]" : "max-w-[34ch]",
                    )}
                  >
                    {card.description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-20">
          <h3 className="mx-auto text-balance text-center text-[1.8rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
            You&apos;ll recognise Olio if you&apos;ve said
          </h3>
          <ul className="mx-auto mt-12 grid max-w-5xl list-none gap-6 sm:grid-cols-2 sm:gap-x-12 sm:gap-y-8 lg:gap-x-16 lg:gap-y-10">
            {RECOGNITION_QUOTES.map((quote) => (
              <li
                className={cn(
                  "group/quote w-fit max-w-[420px] self-start rounded-[2.25rem] max-sm:justify-self-center max-sm:text-center sm:row-span-2 border border-olive-deep/70 px-7 py-6 text-olive-deep transition-[translate,rotate,border-color] duration-500 ease-out hover:border-olive-deep motion-safe:hover:-translate-y-1 motion-safe:hover:rotate-0 lg:px-8 lg:py-7",
                  quote.scatter,
                )}
                data-ed-article
                key={quote.text}
              >
                <span
                  className="block text-[3rem] font-semibold leading-[0.5] text-gold transition-[translate] duration-500 ease-out motion-safe:group-hover/quote:-translate-y-0.5"
                  aria-hidden="true"
                >
                  &ldquo;
                </span>
                <p className="mt-1 max-w-[22ch] text-[clamp(1.3rem,2.1vw,1.85rem)] font-medium leading-[1.16] tracking-[-0.03em] max-sm:mx-auto">
                  {quote.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LandingSection>
  );
}
