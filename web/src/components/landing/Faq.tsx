"use client";

import { useState } from "react";
import { LandingSection } from "./LandingSection";

const DISCORD_URL = "https://discord.gg/pyVMUFWRhB";

const FAQ_ITEMS = [
  {
    question: "Who is Olio built for?",
    answer:
      "Businesses that bill in USDC: service businesses with customers abroad, sole proprietors and independent professionals, and small businesses that need records, not just payments. Olio isn't built for consumer checkout.",
  },
  {
    question: "Do my customers need to use Olio?",
    answer:
      "No. Send an invoice, or share a payment link or QR code. Your customer pays in USDC from Stellar, Ethereum, Base, Arbitrum, Avalanche or Solana, without an Olio account.",
  },
  {
    question: "Do I need to verify?",
    answer:
      "Yes, before you receive payments. Verify as a company, or as an individual if you work as a sole proprietor. Olio uses Sumsub for the identity checks.",
  },
  {
    question: "How much does Olio cost?",
    answer:
      "A flat 2% service fee, added on top and paid by your customer. On a 100 USDC invoice your customer pays 102 USDC and you receive the full 100. Checkout shows the fee before they pay, and Olio covers your network fees.",
  },
  {
    question: "What stays private?",
    answer:
      "Your revenue, your customers and what each of them pays you. Payments settle into a private balance only you can read, and invoice contents are encrypted in your browser. When you cash out, the amount and destination are visible on chain.",
  },
  {
    question: "Can I still prove I received a payment?",
    answer:
      "Yes. Each payment is matched to the invoice it paid, so nobody can mark an invoice paid by hand. When a bank, accountant or tax office asks, disclose that single payment as a PDF receipt. The rest stays private.",
  },
  {
    question: "What is the Business Passport?",
    answer:
      "Once your verification is approved, Olio issues an Identity Verified badge with a public link. Customers can confirm Olio verified your business without seeing your revenue, customers or balance. The badge stays private until you choose to publish it.",
  },
  {
    question: "How is Olio different from a crypto mixer?",
    answer:
      "A mixer hides where money came from and gives you no practical way to prove a single transaction. On Olio, every business goes through identity verification before it can receive payments, and each settlement is matched to the invoice it paid. Payments stay private from the public, and you can still prove any one of them.",
  },
  {
    question: "Why not just create a new wallet for every payment?",
    answer:
      "Managing dozens or hundreds of wallets quickly becomes impractical, and moving funds between them can still reveal payment patterns on a public ledger. Olio keeps your revenue private without asking you to manage a new wallet for every invoice.",
  },
  {
    question: "Will Olio ever ask for my PIN?",
    answer:
      "Never. Not by email, chat, phone or anyone claiming to be support. Only enter your PIN in the Olio app itself. Anyone asking for it is trying to take your account.",
  },
  {
    question: "Why build on Stellar?",
    answer:
      "Stellar provides fast settlement, low transaction fees, native USDC support, and strong cross-border payment infrastructure, making it practical for everyday business payments.",
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
    <LandingSection id="faq" data-ed-section aria-labelledby="faq-title">
      <div className="grid w-full gap-12 lg:grid-cols-[0.74fr_1.26fr] lg:gap-20">
        <div className="flex flex-col gap-10 lg:sticky lg:top-24 lg:min-h-[480px] lg:self-start lg:justify-between lg:gap-0">
          <div>
            <h2
              className="type-landing-section-title max-w-[7ch] text-balance text-ink"
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
              className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-lg bg-ink px-6 text-center text-base font-semibold text-paper transition-[background,transform] duration-150 ease-out hover:bg-olive-deep motion-safe:hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sage sm:mt-8 sm:w-auto sm:px-8"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
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
                    className="flex min-h-[78px] w-full cursor-pointer items-center justify-between gap-3 py-5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sage sm:min-h-[86px] sm:gap-6 sm:py-6"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleItem(item.question)}
                  >
                    <span className="max-w-[760px] text-balance text-base font-medium leading-[1.45] tracking-[-0.025em] text-ink sm:text-[clamp(1rem,2vw,2rem)] sm:leading-[1.02] sm:tracking-[-0.045em]">
                      {item.question}
                    </span>
                    <span
                      className="relative grid size-11 shrink-0 place-items-center rounded-lg bg-paper text-ink shadow-[0_10px_28px_rgba(32,38,26,0.06)] transition-[background,color,transform] duration-150 ease-out group-data-[open=true]:bg-olive-deep group-data-[open=true]:text-paper motion-safe:group-hover:scale-105 sm:-mr-5 sm:size-12"
                      aria-hidden="true"
                    >
                      <span className="absolute h-0.5 w-5 bg-current" />
                      <span className="absolute h-5 w-0.5 bg-current transition-[opacity,transform] duration-150 group-data-[open=true]:rotate-90 group-data-[open=true]:opacity-0" />
                    </span>
                  </button>
                  <div
                    aria-hidden={!isOpen}
                    className="grid grid-rows-[0fr] transition-[grid-template-rows,opacity] duration-300 ease-out data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100 motion-reduce:transition-none"
                    data-open={isOpen}
                    id={answerId}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="max-w-[720px] pb-7 pr-2 sm:pr-10">
                        <p className="text-base font-medium leading-[1.62] text-ink/72 sm:text-[1.05rem]">
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
    </LandingSection>
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
