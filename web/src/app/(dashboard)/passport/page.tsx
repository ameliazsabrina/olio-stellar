"use client";

import { useEffect } from "react";
import { PassportDashboard } from "@/components/dashboard/PassportDashboard";
import { useWallet } from "@/components/WalletProvider";
import { SIGN_IN_PATH } from "@/lib/auth-routes";

export default function DashboardPassportPage() {
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
        aria-label="Loading passport"
      >
        <div className="mb-7 space-y-3">
          <div className="h-12 w-48 max-w-full rounded-lg bg-brand-linen/12" />
          <div className="h-4 w-96 max-w-full rounded-full bg-brand-linen/8" />
        </div>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          <div className="h-[19rem] rounded-[2.25rem] bg-brand-linen/8 ring-1 ring-brand-linen/15 lg:col-span-7" />
          <div className="h-[19rem] rounded-[2.25rem] bg-brand-linen/12 ring-1 ring-brand-linen/15 lg:col-span-5" />
          <div className="h-40 rounded-[2.25rem] bg-brand-linen/12 ring-1 ring-brand-linen/15 lg:col-span-12" />
        </div>
      </div>
    );
  }

  return <PassportDashboard />;
}
