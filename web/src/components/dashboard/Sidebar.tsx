"use client";

import {
  Activity,
  LayoutDashboard,
  Link2,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "../ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { useWallet } from "../WalletProvider";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Links", href: "/dashboard#links", icon: Link2 },
  { label: "Activities", href: "/dashboard#activity", icon: Activity },
  { label: "Settings", href: "/dashboard#settings", icon: Settings },
] as const;

function IdentityChip() {
  const { username, disconnect } = useWallet();
  return (
    <Badge
      variant="secondary"
      className="h-auto w-fit cursor-pointer rounded-full px-3 py-1.5 font-sans text-xs hover:border-olive"
      title="Sign out"
      onClick={disconnect}
    >
      {username ? `@${username}` : "Account"}
    </Badge>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 pt-5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image
            src="/assets/olio.svg"
            alt="Olio"
            width={36}
            height={36}
            className="h-9 w-9"
          />
          <span className="font-heading text-lg font-semibold text-olive-deep">
            Olio
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    render={
                      <Link href={href} onClick={() => setOpenMobile(false)} />
                    }
                    isActive={
                      pathname === "/dashboard" && href === "/dashboard"
                    }
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-4 px-4 pb-6">
        <div className="flex items-start gap-2 rounded-lg border border-line bg-sage/50 px-3 py-3 text-xs text-muted-text">
          <ShieldCheck
            className="size-4 shrink-0 text-olive"
            aria-hidden="true"
          />
          <span>Testnet · payments are private by default.</span>
        </div>
        <IdentityChip />
        <div className="flex gap-4 px-1 text-xs text-muted-text">
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
      </SidebarFooter>
    </Sidebar>
  );
}
