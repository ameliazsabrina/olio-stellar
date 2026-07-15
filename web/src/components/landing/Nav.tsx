"use client";

import { ChevronDown, LayoutDashboard, LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "../WalletProvider";
import { StellarWalletModal } from "./StellarWalletModal";

export function EditionsTopNav() {
  const router = useRouter();
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
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-between gap-2 bg-gradient-to-b from-olive-deep/50 to-olive-deep/0 px-[clamp(16px,4vw,40px)] py-3 text-ed-cream transition-[background,border-color,backdrop-filter] duration-300 data-[scrolled=true]:border-ed-line data-[scrolled=true]:from-ed-dark-2/82 data-[scrolled=true]:to-ed-dark-2/56 data-[scrolled=true]:backdrop-blur-md sm:gap-[18px] sm:py-4"
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

      <div className="flex min-w-0 flex-none items-center gap-2 sm:gap-6">
        {address && usernameResolved && !username && (
          <button
            type="button"
            className="inline-flex text-xs font-medium text-ed-gold transition-colors hover:text-ed-cream sm:text-sm"
            onClick={openUsernameModal}
            aria-label="Claim username"
          >
            <span className="sm:hidden">Claim</span>
            <span className="hidden sm:inline">Claim username</span>
          </button>
        )}
        {address ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="group inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-ed-line bg-transparent px-[18px] font-mono text-sm font-medium text-ed-cream outline-none transition-colors hover:border-ed-cream/40 hover:bg-ed-cream/[0.06] focus-visible:border-ed-cream/60 focus-visible:ring-2 focus-visible:ring-ed-cream/20 data-popup-open:border-ed-cream/40 data-popup-open:bg-ed-cream/[0.06]"
              title={address}
            >
              <span className="max-w-24 truncate sm:max-w-40">
                {`@${username}`}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[popup-open]:rotate-180"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="min-w-44 border border-ed-line bg-ed-dark-2 p-1.5 text-ed-cream shadow-xl ring-0"
            >
              <DropdownMenuItem
                className="cursor-pointer px-2.5 py-2 font-medium text-ed-cream [&_svg]:text-ed-cream focus:bg-ed-cream/[0.12] focus:text-ed-cream focus:[&_svg]:text-ed-cream"
                onClick={() => router.push("/dashboard")}
              >
                <LayoutDashboard className="text-ed-cream" aria-hidden="true" />
                Dashboard
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-ed-line" />
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer px-2.5 py-2"
                onClick={disconnect}
              >
                <LogOut aria-hidden="true" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-[42px] items-center rounded-lg border border-ed-cream bg-ed-cream px-4 text-sm font-semibold text-ed-dark transition-colors hover:bg-white disabled:cursor-default disabled:opacity-55 sm:min-h-[38px] sm:px-[18px] sm:text-base"
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
