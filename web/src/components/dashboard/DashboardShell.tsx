"use client";

import { NotificationInbox } from "./NotificationInbox";
import {
  ArrowDownToLine,
  LayoutGrid,
  Link2,
  LogOut,
  type LucideIcon,
  Moon,
  Receipt,
  Settings,
  Sun,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  DASHBOARD_PATH,
  HISTORY_PATH,
  LINKS_PATH,
  SETTINGS_PATH,
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

type NavItem = { label: string; href: string; icon: LucideIcon };

const PAGES: NavItem[] = [
  { label: "Overview", href: DASHBOARD_PATH, icon: LayoutGrid },
  { label: "Payment links", href: LINKS_PATH, icon: Link2 },
  { label: "Payments", href: HISTORY_PATH, icon: Receipt },
  { label: "Withdraw", href: WITHDRAW_PATH, icon: ArrowDownToLine },
];
const SETTINGS_ITEM: NavItem = {
  label: "Settings",
  href: SETTINGS_PATH,
  icon: Settings,
};

const glassChrome =
  "border border-white/24 bg-brand-obsidian/45 backdrop-blur-[10px]";
const roundControl = `${glassChrome} flex size-11 shrink-0 items-center justify-center rounded-full text-brand-linen transition-colors hover:bg-brand-obsidian/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen`;

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
      {navigation ? <DashboardRail /> : null}
      <main
        id="main-content"
        className={cn(
          "relative isolate mx-auto w-full px-(--dashboard-gutter) py-5 sm:py-6 lg:py-8",
          navigation
            ? "max-w-[87.5rem] pb-28 lg:pr-10 lg:pb-10 lg:pl-40"
            : "max-w-7xl",
          contentClassName,
        )}
      >
        {navigation ? <DashboardHeader /> : null}
        {children}
      </main>
      {navigation ? <DashboardBottomBar /> : null}
    </div>
  );
}

function isActive(pathname: string, href: string) {
  return href === DASHBOARD_PATH
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function DashboardRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard navigation"
      className="fixed top-8 bottom-8 left-8 z-40 hidden w-[6.25rem] flex-col items-center justify-between overflow-y-auto rounded-[1.75rem] border border-white/40 bg-linear-to-b from-brand-obsidian/45 to-brand-obsidian/60 p-3 shadow-[inset_0_1px_1px_rgb(255_255_255/0.22)] backdrop-blur-md lg:flex"
    >
      <div className="grid gap-3">
        <Link
          href="/"
          aria-label="Olio home"
          className="flex h-14 w-[4.75rem] items-center justify-center rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
        >
          <Image
            src="/assets/olio-white.svg"
            alt=""
            width={56}
            height={56}
            className="size-14"
          />
        </Link>
        <ul className="grid gap-1.5">
          {PAGES.map((item) => (
            <li key={item.href}>
              <RailLink item={item} active={isActive(pathname, item.href)} />
            </li>
          ))}
        </ul>
      </div>
      <RailLink
        item={SETTINGS_ITEM}
        active={isActive(pathname, SETTINGS_PATH)}
      />
    </nav>
  );
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-16 w-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-[1.125rem] text-[0.6875rem] leading-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen",
        active
          ? "bg-brand-linen !text-brand-obsidian"
          : "text-brand-linen/88 hover:bg-brand-linen/10 hover:text-brand-linen",
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

function DashboardBottomBar() {
  const pathname = usePathname();
  const items = [...PAGES, SETTINGS_ITEM];

  return (
    <nav
      aria-label="Dashboard pages"
      className="fixed inset-x-3 bottom-3 z-40 rounded-[1.375rem] border border-white/40 bg-brand-obsidian/60 p-1.5 shadow-[inset_0_1px_1px_rgb(255_255_255/0.22)] backdrop-blur-md lg:hidden"
    >
      <ul className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[0.625rem] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen",
                  active
                    ? "bg-brand-linen !text-brand-obsidian"
                    : "text-brand-linen/85",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate px-1">
                  {item.label === "Payment links" ? "Links" : item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function DashboardHeader() {
  const pathname = usePathname();
  const { username, disconnect } = useWallet();
  const { theme, toggleTheme } = useDashboardTheme();
  const isOverview = pathname === DASHBOARD_PATH;
  const identity = username ? `@${username}` : "Account";
  const dark = theme === "dark";

  return (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/"
          aria-label="Olio home"
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen lg:hidden"
        >
          <Image
            src="/assets/olio-white.svg"
            alt=""
            width={48}
            height={48}
            className="size-12"
          />
        </Link>
        {isOverview ? (
          <div className="min-w-0">
            <h1 className="truncate font-heading text-xl leading-7 sm:text-[1.875rem] sm:leading-9 font-semibold tracking-[-0.02em] text-brand-linen">
              Hello, {username || "there"}
            </h1>
            <p className="mt-1 hidden text-[0.8125rem] leading-[1.1875rem] text-brand-linen/88 sm:block">
              Every payment you receive lands privately, in a shared pool
              instead of on a public balance.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={toggleTheme}
          className={roundControl}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          title={dark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {dark ? (
            <Sun className="size-[1.125rem]" aria-hidden="true" />
          ) : (
            <Moon className="size-[1.125rem]" aria-hidden="true" />
          )}
        </button>

        <NotificationInbox />
        <DropdownMenu>
          <DropdownMenuTrigger
            id="dashboard-account-menu-trigger"
            className={`${roundControl} text-base font-semibold uppercase`}
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
