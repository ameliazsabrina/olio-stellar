"use client";

import { useEffect } from "react";
import { Dashboard } from "../../components/dashboard/Dashboard";
import { DashboardShell } from "../../components/dashboard/DashboardShell";
import { Card } from "../../components/ui/card";
import { useWallet } from "../../components/WalletProvider";
import { SIGN_IN_PATH } from "../../lib/auth-routes";

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
  return (
    <DashboardShell
      navigation
      header={
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-12 w-52 max-w-full rounded-lg bg-white/12 sm:h-14 sm:w-64" />
          <div className="h-4 w-96 max-w-full rounded-full bg-white/8" />
        </div>
      }
    >
      <div
        className="motion-safe:animate-pulse"
        role="status"
        aria-busy="true"
        aria-label="Loading your private dashboard"
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.9fr)] lg:gap-x-6 lg:gap-y-5 xl:gap-x-7">
          <div className="grid min-w-0 gap-5">
            <Card appearance="glass" className="gap-0 p-0">
              <div className="grid gap-7 p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-3">
                    <div className="h-4 w-40 rounded-full bg-white/10" />
                    <div className="h-11 w-36 rounded-lg bg-white/10" />
                  </div>
                  <div className="flex gap-2">
                    <div className="size-11 rounded-xl bg-white/15 ring-1 ring-white/25" />
                    <div className="size-11 rounded-xl bg-white/15 ring-1 ring-white/25" />
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="h-4 w-14 rounded-full bg-white/8" />
                  <div className="flex min-h-16 items-center gap-3 rounded-lg bg-white/7 p-3 ring-1 ring-white/12">
                    <div className="size-11 shrink-0 rounded-lg bg-white/10" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-24 rounded-full bg-white/10" />
                      <div className="h-3 w-20 rounded-full bg-white/8" />
                    </div>
                    <div className="h-4 w-20 rounded-full bg-white/10" />
                  </div>
                </div>
              </div>
            </Card>

            <Card
              appearance="glass"
              className="justify-between gap-4 p-5 sm:p-6"
            >
              <div className="space-y-2">
                <div className="h-5 w-36 rounded-full bg-white/10" />
                <div className="h-4 w-28 rounded-full bg-white/8" />
              </div>
              <div className="grid gap-3">
                <div className="flex min-h-16 items-center gap-3 rounded-lg bg-white/7 p-3 ring-1 ring-white/12">
                  <div className="size-10 shrink-0 rounded-lg bg-white/10" />
                  <div className="h-4 w-56 max-w-full rounded-full bg-white/10" />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-10 rounded-xl bg-white/15 ring-1 ring-white/25"
                    />
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <Card appearance="glass" className="gap-5 p-5 sm:p-6 lg:self-stretch">
            <div className="flex items-center justify-between gap-3">
              <div className="h-5 w-20 rounded-full bg-white/10" />
              <div className="h-9 w-24 rounded-xl bg-white/15 ring-1 ring-white/25" />
            </div>
            <div className="h-12 w-64 max-w-full rounded-lg bg-white/7 ring-1 ring-white/12" />
            <div className="divide-y divide-white/10">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center gap-3 py-3.5">
                  <div className="size-10 shrink-0 rounded-lg bg-white/10" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-32 rounded-full bg-white/10" />
                    <div className="h-3 w-20 rounded-full bg-white/8" />
                  </div>
                  <div className="h-4 w-24 rounded-full bg-white/10" />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <p className="sr-only">
          Preparing your private balance and payment history.
        </p>
      </div>
    </DashboardShell>
  );
}
