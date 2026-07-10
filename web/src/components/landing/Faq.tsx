"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    question: "Do clients need to understand crypto?",
    answer:
      "No. They use a payment link and pay through the supported stablecoin flow. Olio handles the privacy layer behind the scenes.",
  },
  {
    question: "Is this hiding income from accountants or tax authorities?",
    answer:
      "No. The goal is selective disclosure. Your payment details stay private by default, but you can generate proof for a specific payment when a bank, accountant, or tax process needs it.",
  },
  {
    question: "Why not just use a new wallet for every payment?",
    answer:
      "Separate wallets only help until funds move together. Once balances are consolidated, public ledger history can still reveal patterns about your revenue and customers.",
  },
  {
    question: "What kind of payments is Olio for?",
    answer:
      "Olio is built for freelancers, creators, agencies, and small businesses that accept stablecoin payments and do not want every transaction to become public business intelligence.",
  },
  {
    question: "Why build on Stellar?",
    answer:
      "Stellar gives Olio fast settlement, low transaction costs, native USDC support, cross-border reach, and practical cash-out paths to local currency.",
  },
] as const;

export function Faq() {
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());

  const toggleItem = (question: string) => {
    setOpenItems((current) => {
      const next = new Set(current);
      if (next.has(question)) {
        next.delete(question);
      } else {
        next.add(question);
      }
      return next;
    });
  };

  return (
    <section
      className="relative z-20 bg-paper px-[clamp(20px,5vw,72px)] py-20 text-ink sm:py-24"
      id="faq"
      aria-labelledby="faq-title"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.74fr_1.26fr] lg:gap-20">
        <div className="flex min-h-[480px] flex-col justify-between lg:sticky lg:top-24 lg:self-start">
          <div>
            <h2
              className="max-w-[7ch] text-balance text-[clamp(4rem,7vw,5rem)] font-semibold leading-[0.82] tracking-[-0.075em] text-ink"
              id="faq-title"
            >
              Have questions?
            </h2>
          </div>

          <div className="max-w-[280px]">
            <p className="text-[clamp(1.35rem,2vw,1.8rem)] font-medium leading-[0.98] tracking-[-0.04em] text-ink">
              Have more questions? Join the Discord server.
            </p>
            <a
              className="mt-8 inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-ink px-8 text-base font-semibold text-paper transition-[background,transform] duration-150 ease-out hover:bg-olive-deep motion-safe:hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sage"
              href="#top"
            >
              <DiscordLogo />
              Join Discord server
            </a>
          </div>
        </div>

        <div>
          <p className="mb-7 max-w-[44ch] text-[1.05rem] font-medium leading-[1.55] text-muted-text lg:hidden">
            Privacy should feel practical, not mysterious. These are the
            questions that usually come up first.
          </p>

          <div className="border-t border-olive-deep/14">
            {FAQ_ITEMS.map((item) => {
              const isOpen = openItems.has(item.question);
              const answerId = `faq-answer-${item.question
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")}`;

              return (
                <div
                  className="group border-b border-olive-deep/14 transition-colors duration-150 data-[open=true]:bg-paper/22 motion-safe:hover:bg-paper/18"
                  data-open={isOpen}
                  key={item.question}
                >
                  <button
                    type="button"
                    className="flex min-h-[86px] w-full cursor-pointer items-center justify-between gap-6 py-6 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sage"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleItem(item.question)}
                  >
                    <span className="max-w-[760px] text-balance text-[clamp(1rem,2vw,2rem)] font-medium leading-[1.02] tracking-[-0.045em] text-ink">
                      {item.question}
                    </span>
                    <span
                      className="relative -mr-3 grid size-12 shrink-0 place-items-center rounded-full bg-paper text-ink shadow-[0_10px_28px_rgba(32,38,26,0.06)] transition-[background,color,transform] duration-150 ease-out group-data-[open=true]:bg-olive-deep group-data-[open=true]:text-paper motion-safe:group-hover:scale-105 sm:-mr-5"
                      aria-hidden="true"
                    >
                      <span className="absolute h-0.5 w-5 bg-current" />
                      <span className="absolute h-5 w-0.5 bg-current transition-[opacity,transform] duration-150 group-data-[open=true]:rotate-90 group-data-[open=true]:opacity-0" />
                    </span>
                  </button>
                  <div
                    className="grid grid-rows-[0fr] transition-[grid-template-rows,opacity] duration-300 ease-out data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100 motion-reduce:transition-none"
                    data-open={isOpen}
                    id={answerId}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="max-w-[720px] pb-7 pr-10">
                        <p className="text-[1.05rem] font-medium leading-[1.62] text-ink/72">
                          {item.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function DiscordLogo() {
  return (
    <svg
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19.54 5.34A18.4 18.4 0 0 0 15.04 4c-.2.35-.42.82-.58 1.19a17.1 17.1 0 0 0-4.94 0A12.6 12.6 0 0 0 8.94 4c-1.58.27-3.1.72-4.5 1.34C1.6 9.55.83 13.65 1.22 17.7A18.5 18.5 0 0 0 6.74 20.5c.45-.61.84-1.26 1.18-1.95-.65-.24-1.27-.54-1.84-.9.15-.11.3-.23.44-.35a13.2 13.2 0 0 0 10.96 0l.44.35c-.58.36-1.2.66-1.85.9.34.69.74 1.34 1.18 1.95a18.4 18.4 0 0 0 5.53-2.8c.46-4.7-.78-8.76-3.24-12.36ZM8.68 15.22c-1.08 0-1.97-.99-1.97-2.2 0-1.2.87-2.2 1.97-2.2s1.99 1 1.97 2.2c0 1.21-.87 2.2-1.97 2.2Zm6.64 0c-1.08 0-1.97-.99-1.97-2.2 0-1.2.87-2.2 1.97-2.2s1.99 1 1.97 2.2c0 1.21-.87 2.2-1.97 2.2Z" />
    </svg>
  );
}
