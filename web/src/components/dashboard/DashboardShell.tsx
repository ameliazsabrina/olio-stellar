"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "../ui/sidebar";
import { DashboardSidebar } from "./Sidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardSidebar />
      <SidebarInset className="bg-paper">
        <header className="flex items-center gap-2 border-b border-line bg-panel px-4 py-3 md:hidden">
          <SidebarTrigger className="text-olive-deep" />
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
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10 lg:px-10">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
