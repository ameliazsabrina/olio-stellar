"use client";

import { useEffect } from "react";
import { InvoicesDashboard } from "@/components/dashboard/InvoicesDashboard";
import { useWallet } from "@/components/WalletProvider";
import { SIGN_IN_PATH } from "@/lib/auth-routes";

export default function DashboardInvoicesPage() {
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
        aria-label="Loading invoices"
      >
        <div className="mb-7 space-y-3">
          <div className="h-12 w-48 max-w-full rounded-lg bg-brand-linen/12" />
          <div className="h-4 w-96 max-w-full rounded-full bg-brand-linen/8" />
        </div>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          <div className="h-[19rem] rounded-[2.25rem] bg-brand-linen/8 ring-1 ring-brand-linen/15 md:col-span-2 lg:col-span-8" />
          <div className="h-[19rem] rounded-[2.25rem] bg-brand-linen/12 ring-1 ring-brand-linen/15 md:col-span-2 lg:col-span-4" />
        </div>
      </div>
    );
  }

  return <InvoicesDashboard />;
}
