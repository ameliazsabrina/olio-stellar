"use client";

import { useEffect } from "react";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { Card } from "@/components/ui/card";
import { useWallet } from "@/components/WalletProvider";
import { SIGN_IN_PATH } from "@/lib/auth-routes";

export default function DashboardPage() {
  const { address, sessionReady } = useWallet();

  useEffect(() => {
    if (!sessionReady || address) return;
    window.location.replace(SIGN_IN_PATH);
  }, [address, sessionReady]);

  if (!sessionReady || !address) {
    return <DashboardLoadingState />;
  }

  return <Dashboard />;
}

function DashboardLoadingState() {
  // Same footprint as the Overview bento: grid classes, appearance.
  // Half-width shortcut cards on mobile mirror the compact action tiles.
  const full = "order-1 col-span-2 md:order-none md:col-span-1 min-h-60";
  const compact = "order-3 md:order-none min-h-[9.375rem]";
  const tiles = [
    [full, "hero"],
    [compact, "glass"],
    ["order-2 col-span-2 md:order-none min-h-60", "linen"],
    [compact, "glass"],
    ["order-4 col-span-2 md:order-none md:col-span-1 min-h-60", "linen"],
    [compact, "linen"],
    [compact, "glass"],
    ["order-5 col-span-2 md:order-none min-h-60", "linen"],
    ["order-5 col-span-2 md:order-none min-h-60", "linen"],
  ] as const;

  return (
    <div
      className="motion-safe:animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading your private dashboard"
    >
      <div className="dashboard-bento grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4">
        {tiles.map(([span, appearance], index) => (
          <Card
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
            key={index}
            appearance={appearance}
            className={`${span} gap-4 rounded-[1.75rem] p-6 md:min-h-68`}
          >
            <div className="h-6 w-32 rounded-full bg-current/10" />
            <div className="h-12 rounded-2xl bg-current/8" />
            <div className="mt-auto h-10 w-36 rounded-full bg-current/10" />
          </Card>
        ))}
      </div>

      <p className="sr-only">
        Preparing your private balance and payment history.
      </p>
    </div>
  );
}
