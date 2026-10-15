"use client";

import { useEffect } from "react";
import { SettingsDashboard } from "@/components/dashboard/SettingsDashboard";
import { useWallet } from "@/components/WalletProvider";
import { SIGN_IN_PATH } from "@/lib/auth-routes";

export default function DashboardSettingsPage() {
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
        aria-label="Loading settings"
      >
        <div className="mb-7 space-y-3">
          <div className="h-12 w-48 max-w-full rounded-lg bg-brand-linen/12" />
          <div className="h-4 w-96 max-w-full rounded-full bg-brand-linen/8" />
        </div>
        <div className="flex flex-col overflow-hidden rounded-[1.75rem] bg-brand-linen/12 ring-1 ring-brand-linen/15 lg:min-h-[32rem] lg:flex-row">
          <div className="flex gap-2 border-b border-brand-linen/15 p-3 lg:w-60 lg:flex-col lg:border-r lg:border-b-0 lg:p-5">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-10 w-24 shrink-0 rounded-xl bg-brand-linen/10 lg:w-full"
              />
            ))}
          </div>
          <div className="flex-1 space-y-6 px-5 py-6 sm:px-8 sm:py-7">
            <div className="h-6 w-32 rounded-full bg-brand-linen/12" />
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="flex items-start justify-between gap-8 border-t border-brand-linen/15 pt-5"
              >
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 max-w-full rounded-full bg-brand-linen/12" />
                  <div className="h-3 w-80 max-w-full rounded-full bg-brand-linen/8" />
                </div>
                <div className="h-10 w-28 shrink-0 rounded-lg bg-brand-linen/10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <SettingsDashboard />;
}
