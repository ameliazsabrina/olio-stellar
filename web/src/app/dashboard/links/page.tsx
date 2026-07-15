"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "../../../components/dashboard/DashboardShell";
import { LinksDashboard } from "../../../components/dashboard/LinksDashboard";
import { useWallet } from "../../../components/WalletProvider";
import { SIGN_IN_PATH } from "../../../lib/auth-routes";

export default function DashboardLinksPage() {
  const { address, username, sessionReady } = useWallet();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!sessionReady || address) return;
    window.location.replace(SIGN_IN_PATH);
  }, [address, sessionReady]);

  if (!sessionReady || !address || !username) {
    return (
      <DashboardShell navigation showBack>
        <div
          className="motion-safe:animate-pulse"
          role="status"
          aria-busy="true"
          aria-label="Loading links page"
        >
          <div className="mb-8 space-y-3">
            <div className="h-12 w-56 max-w-full rounded-lg bg-white/12" />
            <div className="h-4 w-96 max-w-full rounded-full bg-white/8" />
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
            <div className="h-96 rounded-xl bg-white/8 ring-1 ring-white/15" />
            <div className="h-64 rounded-xl bg-white/8 ring-1 ring-white/15" />
          </div>
        </div>
      </DashboardShell>
    );
  }

  return <LinksDashboard username={username} origin={origin} />;
}
