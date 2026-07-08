"use client";

import Image from "next/image";
import Link from "next/link";
import { useWallet } from "../WalletProvider";

const LINKS = [
  { id: "links", label: "Payment links" },
  { id: "shield", label: "Shielded pool" },
  { id: "withdraw", label: "Withdrawals" },
];

export function EditionsTopNav() {
  const { address, connecting, connectPrivy, disconnect } = useWallet();

  return (
    <header
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-between gap-[18px] border-b border-transparent px-[clamp(18px,4vw,40px)] py-4 text-ed-cream transition-[background,border-color,backdrop-filter] duration-300 data-[scrolled=true]:border-ed-line data-[scrolled=true]:bg-ed-dark-2/72 data-[scrolled=true]:backdrop-blur-md"
      data-ed-topnav
      aria-label="Primary"
    >
      <a
        className="flex flex-none items-center gap-2.5"
        href="#top"
        aria-label="Olio Editions — top"
      >
        <Image
          src="/assets/olio-white.svg"
          alt=""
          width={48}
          height={48}
          priority
          className="scale-125"
        />
      </a>

      <nav className="hidden items-center gap-[26px] lg:flex" aria-label="Sections">
        {LINKS.map((l) => (
          <a
            key={l.id}
            href={`#${l.id}`}
            data-ed-navlink={l.id}
            className="text-sm font-medium text-ed-cream/72 transition-colors data-[active=true]:text-ed-cream"
          >
            {l.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-none items-center gap-3">
        <Link href="/wallet" className="text-sm font-medium text-ed-cream/72 hover:text-ed-cream">
          Wallet
        </Link>
        {address ? (
          <button
            className="inline-flex min-h-[38px] items-center rounded-full border border-ed-line bg-transparent px-[18px] font-mono text-sm font-medium text-ed-cream transition-colors hover:border-ed-cream/40 hover:bg-ed-cream/[0.06]"
            onClick={disconnect}
            title={`${address} — click to disconnect`}
          >
            {`${address.slice(0, 4)}…${address.slice(-4)}`}
          </button>
        ) : (
          <button
            className="inline-flex min-h-[38px] items-center rounded-full border border-ed-cream bg-ed-cream px-[18px] text-sm font-semibold text-ed-dark transition-colors hover:bg-white disabled:cursor-default disabled:opacity-55"
            onClick={connectPrivy}
            disabled={connecting}
          >
            {connecting ? "Signing in…" : "Sign in"}
          </button>
        )}
      </div>
    </header>
  );
}
