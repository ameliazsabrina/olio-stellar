"use client";

import { useEffect } from "react";
import { Dashboard } from "../../components/dashboard/Dashboard";
import { useWallet } from "../../components/WalletProvider";
import { SIGN_IN_PATH } from "../../lib/auth-routes";

export default function DashboardPage() {
  const { address, sessionReady } = useWallet();

  useEffect(() => {
    if (!sessionReady || address) return;
    window.location.replace(SIGN_IN_PATH);
  }, [address, sessionReady]);

  if (!sessionReady || !address) {
    return <div className="min-h-svh bg-paper" />;
  }

  return <Dashboard />;
}
