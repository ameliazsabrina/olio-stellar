"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { resolveUsername, type OlioAccount } from "../../../lib/stellar";
import { foot, heroSection, heroTitle, panel, sub } from "../../../lib/ui";
import { PayForm } from "./PayForm";

export default function PayPage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username || "").toLowerCase();

  const [account, setAccount] = useState<OlioAccount | null | "loading">("loading");

  useEffect(() => {
    resolveUsername(username)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [username]);

  if (account === "loading") {
    return (
      <div className={panel}>
        <h2 className="text-lg font-semibold text-ink">Loading @{username}…</h2>
      </div>
    );
  }
  if (!account) {
    return (
      <div className={panel}>
        <h2 className="text-lg font-semibold text-ink">@{username} not found</h2>
        <p className={sub}>No Olio account is registered for this username on testnet.</p>
      </div>
    );
  }

  return (
    <>
      <section className={heroSection}>
        <h1 className={heroTitle}>Pay @{username}</h1>
        <p className={sub}>
          Your payment becomes a confidential note only the recipient can discover and spend.
        </p>
      </section>

      <PayForm account={account} username={username} />

      <p className={foot}>Unlinkable receipt · encrypted to the recipient · Built on Stellar</p>
    </>
  );
}
