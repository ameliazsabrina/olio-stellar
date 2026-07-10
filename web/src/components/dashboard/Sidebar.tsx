"use client";

import {
  Activity,
  LayoutDashboard,
  Link2,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import { Badge } from "../ui/badge";
import { useWallet } from "../WalletProvider";

const NAV_ITEMS = [
  { label: "Dashboard", href: "#", icon: LayoutDashboard, active: true },
  { label: "Links", href: "#", icon: Link2, active: false },
  { label: "Activities", href: "#activity", icon: Activity, active: false },
  { label: "Settings", href: "#", icon: Settings, active: false },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ label, href, icon: Icon, active }) => (
        <a
          key={label}
          href={href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            active
              ? "bg-sage text-olive-deep"
              : "text-muted-text hover:bg-sage/60 hover:text-olive-deep"
          }`}
        >
          <Icon className="size-[18px]" aria-hidden="true" />
          {label}
        </a>
      ))}
    </nav>
  );
}

function IdentityChip() {
  const { username, disconnect } = useWallet();
  return (
    <Badge
      variant="secondary"
      className="h-auto w-fit cursor-pointer rounded-full px-3 py-1.5 font-sans text-xs hover:border-olive"
      title="Sign out"
      onClick={disconnect}
    >
      @{username}
    </Badge>
  );
}

export function DashboardSidebar() {
  return (
    <>
      <aside className="hidden md:sticky md:top-0 md:flex md:h-svh md:w-64 md:shrink-0 md:flex-col md:justify-between md:border-r md:border-line md:bg-panel md:px-4 md:py-6">
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-2 px-2">
            <Image
              src="/assets/olio.svg"
              alt=""
              width={36}
              height={36}
              className="h-12 w-12"
            />
          </div>

          <NavList />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-lg border border-line bg-sage/50 px-3 py-3 text-xs text-muted-text">
            <ShieldCheck
              className="size-4 shrink-0 text-olive"
              aria-hidden="true"
            />
            <span>Testnet · payments are private by default.</span>
          </div>
          <IdentityChip />
          <div className="flex gap-4 px-2 text-xs text-muted-text">
            <a href="/docs" className="hover:text-olive-deep">
              Docs
            </a>
            <a
              href="https://x.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-olive-deep"
            >
              X (Twitter)
            </a>
          </div>
        </div>
      </aside>

      {/* Mobile: slim top bar, nav collapses to icon row */}
      <header className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Image
            src="/assets/olio.svg"
            alt=""
            width={24}
            height={24}
            className="h-6 w-6"
          />
          <span className="font-heading text-base font-semibold text-olive-deep">
            Olio
          </span>
        </div>
        <IdentityChip />
      </header>
      <nav className="flex items-center gap-1 overflow-x-auto border-b border-line bg-panel px-3 py-2 md:hidden">
        {NAV_ITEMS.map(({ label, href, icon: Icon, active }) => (
          <a
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              active
                ? "bg-sage text-olive-deep"
                : "text-muted-text hover:bg-sage/60"
            }`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>
    </>
  );
}
