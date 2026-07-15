"use client";

import {
  ArrowDownToLine,
  AtSign,
  ChevronDown,
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  Settings,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
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
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { useWallet } from "../WalletProvider";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Links", href: "/dashboard/links", icon: Link2 },
  {
    label: "Withdraw",
    href: "/dashboard/withdraw",
    icon: ArrowDownToLine,
  },
  { label: "History", href: "/dashboard/history", icon: History },
  { label: "Settings", href: "/dashboard#settings", icon: Settings },
] as const;

function IdentityChip() {
  const { username, disconnect } = useWallet();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-white/35 bg-panel/55 px-3 py-2 font-sans text-xs font-medium text-secondary-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-panel/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:shadow-none group-data-[collapsible=icon]:backdrop-blur-none group-data-[collapsible=icon]:hover:bg-transparent">
        <AtSign
          className="hidden size-4 shrink-0 group-data-[collapsible=icon]:block"
          aria-hidden="true"
        />
        <span className="truncate group-data-[collapsible=icon]:hidden">
          {username ? `@${username}` : "Account"}
        </span>
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-data-[popup-open]:rotate-180 group-data-[collapsible=icon]:hidden"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="min-w-40">
        <DropdownMenuItem
          variant="destructive"
          className="min-h-10 cursor-pointer px-3 py-2"
          onClick={disconnect}
        >
          <LogOut aria-hidden="true" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const [activeHref, setActiveHref] = useState(pathname);

  useEffect(() => {
    const syncActiveHref = () => {
      setActiveHref(`${window.location.pathname}${window.location.hash}`);
    };

    syncActiveHref();
    window.addEventListener("hashchange", syncActiveHref);
    return () => window.removeEventListener("hashchange", syncActiveHref);
  }, []);

  return (
    <Sidebar
      collapsible="icon"
      className="border-white/30 [&_[data-slot=sidebar-inner]]:bg-panel/30 [&_[data-slot=sidebar-inner]]:shadow-lg [&_[data-slot=sidebar-inner]]:shadow-ink/5 [&_[data-slot=sidebar-inner]]:backdrop-blur-xl group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:bg-transparent group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:shadow-none group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:backdrop-blur-none"
    >
      <SidebarHeader className="flex-row items-center justify-between px-3 pt-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 group-data-[collapsible=icon]:hidden"
        >
          <Image
            src="/assets/olio-white.svg"
            alt="Olio"
            width={56}
            height={56}
            className="size-14"
          />
        </Link>
        <SidebarTrigger className="size-10 shrink-0 rounded-lg bg-panel/40 text-olive-deep hover:bg-panel/70 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:hover:bg-transparent" />
      </SidebarHeader>

      <SidebarContent className="px-2 pt-0 pb-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={href}
                        title={label}
                        onClick={() => {
                          setActiveHref(href);
                          setOpenMobile(false);
                        }}
                      />
                    }
                    isActive={
                      activeHref === href ||
                      (href === "/dashboard/links" &&
                        activeHref.startsWith("/dashboard/links")) ||
                      (href === "/dashboard/withdraw" &&
                        activeHref.startsWith("/dashboard/withdraw")) ||
                      (href === "/dashboard/history" &&
                        activeHref.startsWith("/dashboard/history"))
                    }
                    className="data-[active=true]:bg-olive-deep data-[active=true]:text-paper data-[active=true]:hover:bg-olive-deep data-[active=true]:hover:text-paper group-data-[collapsible=icon]:hover:bg-transparent group-data-[collapsible=icon]:data-[active=true]:hover:bg-olive-deep"
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

      <SidebarFooter className="gap-4 px-4 pb-6 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
        <IdentityChip />
        <div className="flex gap-4 px-1 text-xs text-muted-text group-data-[collapsible=icon]:hidden">
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
