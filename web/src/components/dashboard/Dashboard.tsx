"use client";

import { useEffect, useState } from "react";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { BalanceCard } from "./BalanceCard";
import { DashboardShell } from "./DashboardShell";
import { PersonalLinkCard } from "./PersonalLinkCard";
import { ReceiveDialog } from "./ReceiveDialog";
import { useMyNotes } from "./useMyNotes";

export function Dashboard() {
  const { address, username, accountUnlocked, promptUnlock } = useWallet();
  const [origin, setOrigin] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const { notes, claimable, loading, refreshing, stale, refresh } =
    useMyNotes(address);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payLink = username && origin ? `${origin}/pay/${username}` : "";
  const locked = Boolean(address) && !accountUnlocked;

  return (
    <DashboardShell
      navigation
      header={
        <div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-white sm:text-5xl">
            <span className="sr-only">Dashboard: </span>
            Hi, {username || "there"}.
          </h1>
          <p className="mt-2 md:max-w-xl text-sm text-white/70 sm:text-base font-medium">
            Receive privately, keep control, and cash out when you are ready.
          </p>
          {(refreshing || stale) && (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-white/60 underline-offset-4 hover:text-white hover:underline"
              onClick={refresh}
            >
              {stale ? "Balance data is delayed — retry" : "Updating balance…"}
            </button>
          )}
        </div>
      }
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.9fr)] lg:gap-x-6 lg:gap-y-5 xl:gap-x-7">
        <div className="grid min-w-0 gap-5">
          <section aria-label="Account summary" className="min-w-0">
            <BalanceCard
              claimable={claimable}
              loading={loading}
              locked={locked}
              onUnlock={promptUnlock}
              onReceive={() => setReceiveOpen(true)}
            />
          </section>

          <div id="links" className="min-w-0">
            <PersonalLinkCard username={username ?? ""} payLink={payLink} />
          </div>
        </div>

        <section
          aria-label="Payment history"
          className="min-w-0 lg:self-stretch"
        >
          <ActivityFeed
            notes={notes}
            loading={loading}
            limit={3}
            showSeeAll
            className="lg:min-h-full"
          />
        </section>
      </div>

      <ReceiveDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        username={username ?? ""}
        origin={origin}
      />
    </DashboardShell>
  );
}
