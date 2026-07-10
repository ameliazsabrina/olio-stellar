"use client";

import type { ReactNode } from "react";
import { DashboardSidebar } from "./Sidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-paper md:flex-row">
      <DashboardSidebar />
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-5 px-4 py-8 md:px-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
