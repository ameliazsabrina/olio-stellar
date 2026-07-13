"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "../../../components/ui/card";
import { usePaymentLink } from "../../../features/paymentLinks/hooks/usePaymentLink";
import { type OlioAccount, resolveUsername } from "../../../lib/stellar";
import { PayForm } from "./PayForm";

export default function PayPage() {
  const params = useParams<{ username: string }>();
  const searchParams = useSearchParams();
  const username = decodeURIComponent(params.username || "").toLowerCase();
  const linkId = searchParams.get("l");
  const link = usePaymentLink(linkId);

  const [account, setAccount] = useState<OlioAccount | null | "loading">(
    "loading",
  );

  useEffect(() => {
    resolveUsername(username)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [username]);

  if (account === "loading") {
    return (
      <Card className="gap-3 p-6">
        <h2 className="text-lg font-semibold text-ink">Loading @{username}…</h2>
      </Card>
    );
  }
  if (!account) {
    return (
      <Card className="gap-3 p-6">
        <h2 className="text-lg font-semibold text-ink">
          @{username} not found
        </h2>
        <p className="text-sm text-muted-foreground">
          No Olio account is registered for this username on testnet.
        </p>
      </Card>
    );
  }

  return (
    <>
      <section className="grid gap-2 pt-4">
        <h1 className="text-3xl font-bold text-ink">Pay @{username}</h1>
        <p className="text-sm text-muted-foreground">
          Your payment becomes a confidential note only the recipient can
          discover and spend.
        </p>
      </section>

      <PayForm account={account} username={username} link={link} />

      <p className="pt-8 text-center text-xs text-muted-foreground">
        Unlinkable receipt · encrypted to the recipient · Built on Stellar
      </p>
    </>
  );
}
