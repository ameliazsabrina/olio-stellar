"use client";

import { useEffect } from "react";
import { HistoryDashboard } from "@/components/dashboard/HistoryDashboard";
import { useWallet } from "@/components/WalletProvider";
import { SIGN_IN_PATH } from "@/lib/auth-routes";

export default function DashboardHistoryPage() {
  const { address, sessionReady } = useWallet();

  useEffect(() => {
    if (!sessionReady || address) return;
    window.location.replace(SIGN_IN_PATH);
  }, [address, sessionReady]);

  if (!sessionReady || !address) {
    return (
      <div
        className="motion-safe:animate-pulse"
        role="status"
        aria-busy="true"
        aria-label="Loading history page"
      >
        <div className="mb-8 space-y-3">
          <div className="h-12 w-56 max-w-full rounded-lg bg-brand-linen/12" />
          <div className="h-4 w-96 max-w-full rounded-full bg-brand-linen/8" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
          <div className="h-96 rounded-xl bg-brand-linen/8 ring-1 ring-brand-linen/15" />
          <div className="h-64 rounded-xl bg-brand-linen/8 ring-1 ring-brand-linen/15" />
        </div>
      </div>
    );
  }

  return <HistoryDashboard />;
}
