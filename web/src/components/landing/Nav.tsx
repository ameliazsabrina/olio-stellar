"use client";

import { ChevronDown, LayoutDashboard, Loader, LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { glassButtonClass } from "@/components/ui/glass";
import { cn } from "@/lib/utils";
import { useWallet } from "../WalletProvider";

export function EditionsTopNav() {
  const router = useRouter();
  const {
    address,
    connecting,
    username,
    usernameResolved,
    openUsernameModal,
    signIn,
    disconnect,
  } = useWallet();

  return (
    <header
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-between gap-2 bg-gradient-to-b from-olive-deep/50 to-olive-deep/0 px-[clamp(16px,4vw,40px)] py-3 text-ed-cream transition-[background,border-color,backdrop-filter] duration-300  data-[scrolled=true]:bg-ed-dark-2/88 data-[scrolled=true]:bg-none data-[scrolled=true]:backdrop-blur-md sm:gap-[18px] sm:py-4"
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
              className={cn(
                glassButtonClass,
                "group inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 data-popup-open:bg-white/20",
              )}
              title={address}
            >
              <span className="max-w-24 truncate sm:max-w-40">
                {username ? `@${username}` : "Account"}
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
                className="cursor-pointer bg-ed-cream/[0.1] px-2.5 py-2 !text-ed-cream focus:bg-ed-cream/[0.16] focus:!text-ed-cream [&_svg]:!text-ed-cream"
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
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-ed-cream bg-ed-cream px-4 text-sm font-semibold text-ed-dark transition-colors hover:bg-white disabled:cursor-default disabled:opacity-55 sm:min-h-[38px] sm:px-[18px] sm:text-base"
            onClick={() => {
              signIn();
            }}
            disabled={connecting}
          >
            {connecting && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {connecting ? "Signing in" : "Sign in"}
          </button>
        )}
      </div>
    </header>
  );
}
