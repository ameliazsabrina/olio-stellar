"use client";

import {
  ArrowDownToLine,
  ChevronDown,
  ChevronLeft,
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Settings,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  DASHBOARD_PATH,
  HISTORY_PATH,
  LINKS_PATH,
  WITHDRAW_PATH,
} from "../../lib/auth-routes";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useWallet } from "../WalletProvider";

const DASHBOARD_ACTIONS = [
  { label: "Overview", icon: LayoutDashboard, href: DASHBOARD_PATH },
  { label: "Links", icon: Link2, href: LINKS_PATH },
  {
    label: "Cash out",
    icon: ArrowDownToLine,
    href: WITHDRAW_PATH,
  },
  { label: "History", icon: History, href: HISTORY_PATH },
] as const;

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
    <div className="relative min-h-svh overflow-x-clip text-white">
      <main
        id="main-content"
        className={cn(
          "relative isolate mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8 lg:py-10 xl:px-6",
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
  const showBack = pathname !== DASHBOARD_PATH;

  return (
    <header className="mb-7 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 pt-4 sm:mb-9 sm:grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-5">
      <div className="min-h-11">
        {showBack ? (
          <Button
            type="button"
            variant="glass"
            size="icon"
            className="size-11"
            onClick={() => window.history.back()}
            aria-label="Go back"
            title="Go back"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
        ) : (
          <Link href="/" aria-label="Olio home" className="block size-14">
            <Image
              src="/assets/olio-white.svg"
              alt=""
              width={48}
              height={48}
              className="size-14"
            />
          </Link>
        )}
      </div>

      <nav
        aria-label="Dashboard navigation"
        className="justify-self-end sm:hidden"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            id="dashboard-nav-menu-trigger"
            className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-xl transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Open dashboard navigation"
          >
            <Menu className="size-5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            appearance="glass"
            align="end"
            sideOffset={8}
            className="min-w-52"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 px-2 py-2 text-white">
                <span className="flex size-7 items-center justify-center rounded-full bg-white/15 text-xs font-bold uppercase">
                  {username?.slice(0, 1) || "O"}
                </span>
                <span className="max-w-36 truncate">
                  {username ? `@${username}` : "Account"}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {DASHBOARD_ACTIONS.map(({ label, icon: Icon, href }) => {
              const current = pathname === href;
              return (
                <DropdownMenuItem
                  key={href}
                  render={<Link href={href} />}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "min-h-11",
                    current && "bg-white/15 text-white",
                  )}
                  onClick={(event) => {
                    if (!current) return;
                    event.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/dashboard#settings" />}>
              <Settings aria-hidden="true" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={disconnect}>
              <LogOut aria-hidden="true" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <nav
        aria-label="Dashboard navigation"
        className="order-3 col-span-full hidden grid-cols-4 gap-2 sm:col-start-1 sm:grid lg:order-none lg:col-span-1 lg:col-start-2"
      >
        {DASHBOARD_ACTIONS.map(({ label, icon: Icon, href }) => {
          const current = pathname === href;
          return (
            <Button
              key={href}
              nativeButton={false}
              render={<Link href={href} />}
              variant="glass"
              onClick={(event) => {
                if (!current) return;
                event.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              aria-current={current ? "page" : undefined}
              className={cn(
                "min-h-11 justify-center gap-2 px-3 text-sm whitespace-nowrap",
                current && "bg-white/25 ring-white/50 hover:bg-white/25",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </Button>
          );
        })}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger
          id="dashboard-account-menu-trigger"
          className="hidden min-h-11 items-center justify-self-end gap-2 rounded-xl bg-white/15 px-3 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur-xl transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70 sm:col-start-3 sm:flex lg:col-start-3"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-white/15 text-xs font-bold uppercase text-white">
            {username?.slice(0, 1) || "O"}
          </span>
          <span className="max-w-32 truncate">
            {username ? `@${username}` : "Account"}
          </span>
          <ChevronDown className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          appearance="glass"
          align="end"
          sideOffset={8}
          className="min-w-48"
        >
          {/* <DropdownMenuItem render={<Link href="/dashboard#settings" />}>
            <Settings aria-hidden="true" /> Settings
          </DropdownMenuItem> */}
          <DropdownMenuItem variant="destructive" onClick={disconnect}>
            <LogOut aria-hidden="true" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
