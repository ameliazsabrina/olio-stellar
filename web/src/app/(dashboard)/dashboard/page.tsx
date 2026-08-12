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
  const tiles = [
    "order-1 lg:col-span-3 lg:col-start-1 lg:row-start-1",
    "order-2 md:col-span-2 lg:col-span-6 lg:col-start-4 lg:row-start-1",
    "order-3 lg:col-span-3 lg:col-start-10 lg:row-start-1",
    "order-4 lg:col-span-3 lg:col-start-1 lg:row-start-2",
    "order-5 lg:col-span-3 lg:col-start-4 lg:row-start-2",
    "order-6 lg:col-span-3 lg:col-start-7 lg:row-start-2",
    "order-7 lg:col-span-3 lg:col-start-10 lg:row-start-2",
  ];

  return (
    <div
      className="motion-safe:animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading your private dashboard"
    >
      <div className="dashboard-bento mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:grid-rows-2 lg:gap-5">
        {tiles.map((className, index) => (
          <Card
            key={className}
            appearance={
              index === 2 || index === 3 || index === 6 ? "glass" : "linen"
            }
            className={`${className} min-h-72 gap-4 rounded-[2.25rem] p-7`}
          >
            <div className="h-7 w-32 rounded-full bg-current/10" />
            <div className="h-16 rounded-2xl bg-current/8" />
            <div className="mt-auto h-11 w-36 rounded-full bg-current/10" />
          </Card>
        ))}
      </div>

      <p className="sr-only">
        Preparing your private balance and payment history.
      </p>
    </div>
  );
}
