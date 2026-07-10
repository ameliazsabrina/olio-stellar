"use client";

import { useEffect, useState } from "react";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { BalanceCard } from "./BalanceCard";
import { DashboardShell } from "./DashboardShell";
import { PersonalLinkCard } from "./PersonalLinkCard";
import { SendDialog } from "./SendDialog";
import { useMyNotes } from "./useMyNotes";

export function Dashboard() {
  const { address, username } = useWallet();
  const [origin, setOrigin] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const { notes, claimable, loading, refresh } = useMyNotes(address);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payLink = username && origin ? `${origin}/pay/${username}` : "";

  return (
    <DashboardShell>
      <h1 className="font-heading text-xl font-semibold text-olive-deep">
        Dashboard
      </h1>

      <BalanceCard
        claimable={claimable}
        loading={loading}
        onSend={() => setSendOpen(true)}
      />
      <PersonalLinkCard username={username ?? ""} payLink={payLink} />
      <ActivityFeed notes={notes} loading={loading} />

      <SendDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        notes={notes}
        onSuccess={refresh}
      />
    </DashboardShell>
  );
}
