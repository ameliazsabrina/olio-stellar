"use client";

import type { ReactNode } from "react";
import { DashboardTile } from "../../../components/dashboard/DashboardTile";

export function PayLoading() {
  return (
    <div
      className="grid gap-5 motion-safe:animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading payment page"
    >
      <div className="space-y-3">
        <div className="h-10 w-56 max-w-full rounded-lg bg-brand-linen/12" />
        <div className="h-4 w-full max-w-96 rounded-full bg-brand-linen/8" />
      </div>
      <div className="h-64 rounded-[1.75rem] bg-brand-linen/8 ring-1 ring-brand-linen/15" />
    </div>
  );
}

export function PayNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <DashboardTile
      appearance="glass"
      className="min-h-0 text-brand-linen"
      header={<h2 className="dashboard-tile-title">{title}</h2>}
      content={
        <p className="mt-3 max-w-md text-sm leading-6 text-brand-linen/70">
          {children}
        </p>
      }
    />
  );
}
