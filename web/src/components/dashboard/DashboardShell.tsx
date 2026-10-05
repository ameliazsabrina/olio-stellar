"use client";

import { NotificationInbox } from "./NotificationInbox";
import { ChevronLeft, LogOut, Moon, Palette } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  DASHBOARD_PATH,
  HISTORY_PATH,
  LINKS_PATH,
  PASSPORT_PATH,
  SETTINGS_PATH,
  VERIFICATION_PATH,
  WITHDRAW_PATH,
} from "../../lib/auth-routes";
import { cn } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useWallet } from "../WalletProvider";
import { useDashboardTheme } from "./DashboardBackground";

const PAGE_LABELS: Record<string, string> = {
  [DASHBOARD_PATH]: "Overview",
  [LINKS_PATH]: "Links",
  [WITHDRAW_PATH]: "Cash out",
  [HISTORY_PATH]: "History",
  [SETTINGS_PATH]: "Settings",
  [VERIFICATION_PATH]: "Verification",
  [PASSPORT_PATH]: "Passport",
};

export function DashboardShell({
  children,
  contentClassName,
  navigation = false,
}: {
  children: ReactNode;
  contentClassName?: string;
  navigation?: boolean;
}) {
  return (
    <div className="relative min-h-svh overflow-x-clip text-brand-linen">
      <main
        id="main-content"
        className={cn(
          "relative isolate mx-auto w-full max-w-7xl px-(--dashboard-gutter) py-5 sm:py-6 lg:py-7",
          contentClassName,
        )}
      >
        {navigation ? <DashboardNavigation /> : null}
        {children}
      </main>
    </div>
  );
}

function DashboardNavigation() {
  const pathname = usePathname();
  const { username, disconnect } = useWallet();
  const { theme, toggleTheme } = useDashboardTheme();
  const currentLabel = PAGE_LABELS[pathname] ?? "Overview";
  const isOverview = pathname === DASHBOARD_PATH;
  const identity = username ? `@${username}` : "Account";

  return (
    <header className="sticky top-4 z-50 mb-12 flex items-center justify-between gap-4 sm:top-5 lg:mb-20">
      <div className="flex min-w-0 items-center gap-3">
        {isOverview ? (
          <Link
            href="/"
            aria-label="Olio home"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
          >
            <Image
              src="/assets/olio-white.svg"
              alt=""
              width={72}
              height={72}
              className="size-16 sm:size-[4.5rem]"
            />
          </Link>
        ) : (
          <Link
            href={DASHBOARD_PATH}
            className="flex size-11 items-center justify-center rounded-full bg-brand-linen/12 text-brand-linen ring-1 ring-brand-linen/20 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
            aria-label="Back to dashboard"
            title="Back to dashboard"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        )}
        {!isOverview ? (
          <span
            className="truncate font-heading text-lg font-semibold text-brand-linen"
            aria-current="page"
          >
            {currentLabel}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={theme === "painting"}
          aria-label={
            theme === "painting"
              ? "Use dark dashboard theme"
              : "Use painting dashboard theme"
          }
          title={theme === "painting" ? "Use dark theme" : "Use painting"}
          onClick={toggleTheme}
          className="relative flex h-11 w-[4.25rem] items-center rounded-full bg-brand-linen/16 p-1 text-brand-linen ring-1 ring-brand-linen/25 backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
        >
          <span
            className={`flex size-9 items-center justify-center rounded-full bg-brand-linen text-brand-obsidian transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
              theme === "painting" ? "translate-x-6" : "translate-x-0"
            }`}
          >
            {theme === "painting" ? (
              <Palette className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </span>
        </button>

        <Link
          href={SETTINGS_PATH}
          className="hidden min-h-11 items-center rounded-full bg-brand-linen/16 px-5 text-sm font-medium text-brand-linen/80 ring-1 ring-brand-linen/20 backdrop-blur-md transition-colors hover:bg-brand-linen/24 hover:text-brand-linen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen sm:flex"
          title="Settings"
        >
          Settings
        </Link>

        <NotificationInbox />
        <DropdownMenu>
          <DropdownMenuTrigger
            id="dashboard-account-menu-trigger"
            className="flex size-11 items-center justify-center rounded-full bg-brand-linen/20 text-sm font-semibold uppercase text-brand-linen ring-1 ring-brand-linen/25 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
            aria-label={`${identity} account menu`}
          >
            {username?.slice(0, 1) || "O"}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            appearance="glass"
            align="end"
            sideOffset={8}
            className="min-w-48"
          >
            <DropdownMenuItem
              className="cursor-pointer bg-brand-linen/10 !text-brand-linen focus:bg-brand-linen/18 focus:!text-brand-linen [&_svg]:!text-brand-linen"
              onClick={disconnect}
            >
              <LogOut aria-hidden="true" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
