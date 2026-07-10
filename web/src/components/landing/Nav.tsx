"use client";

import Image from "next/image";
import { useState } from "react";
import { useWallet } from "../WalletProvider";
import { StellarWalletModal } from "./StellarWalletModal";

export function EditionsTopNav() {
  const {
    address,
    connecting,
    username,
    usernameResolved,
    openUsernameModal,
    disconnect,
  } = useWallet();
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  return (
    <header
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-between gap-[18px] bg-gradient-to-b from-olive-deep/50 to-olive-deep/0 px-[clamp(18px,4vw,40px)] py-4 text-ed-cream transition-[background,border-color,backdrop-filter] duration-300 data-[scrolled=true]:border-ed-line data-[scrolled=true]:from-ed-dark-2/82 data-[scrolled=true]:to-ed-dark-2/56 data-[scrolled=true]:backdrop-blur-md"
      data-ed-topnav
    >
      <a
        className="flex flex-none items-center gap-2.5"
        href="#top"
        aria-label="Olio Editions — top"
      >
        <Image
          src="/assets/olio-white.svg"
          alt=""
          width={40}
          height={40}
          priority
          className="scale-125"
        />
      </a>

      <div className="flex flex-none items-center gap-6">
        {address && usernameResolved && !username && (
          <button
            type="button"
            className="text-md font-medium text-ed-gold transition-colors hover:text-ed-cream"
            onClick={openUsernameModal}
          >
            Claim username
          </button>
        )}
        {address ? (
          <button
            type="button"
            className="inline-flex min-h-[38px] items-center rounded-full border border-ed-line bg-transparent px-[18px] font-mono text-sm font-medium text-ed-cream transition-colors hover:border-ed-cream/40 hover:bg-ed-cream/[0.06]"
            onClick={disconnect}
            title={`${address} — click to disconnect`}
          >
            {username
              ? `@${username}`
              : `${address.slice(0, 4)}…${address.slice(-4)}`}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-[38px] items-center rounded-full border border-ed-cream bg-ed-cream px-[18px] text-md font-semibold text-ed-dark transition-colors hover:bg-white disabled:cursor-default disabled:opacity-55"
            onClick={() => setWalletModalOpen(true)}
            disabled={connecting}
          >
            {connecting ? "Signing in…" : "Sign in"}
          </button>
        )}
      </div>

      <StellarWalletModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </header>
  );
}
