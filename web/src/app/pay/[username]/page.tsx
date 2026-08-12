"use client";

import { Loader } from "lucide-react";
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

  if (account === "loading" || (linkId && link === "loading")) {
    return (
      <div
        className="grid place-items-center"
        role="status"
        aria-label="Loading payment page"
      >
        <Loader
          className="size-8 text-brand-linen motion-safe:animate-spin"
          aria-hidden="true"
        />
      </div>
    );
  }
  if (linkId && !link) {
    return (
      <Card appearance="glass" className="gap-3 p-6">
        <h2 className="text-lg font-semibold text-brand-linen">
          Payment link unavailable
        </h2>
        <p className="text-sm text-brand-linen/60">
          This link may have been archived, deleted, or mistyped.
        </p>
      </Card>
    );
  }
  if (!account) {
    return (
      <Card appearance="glass" className="gap-3 p-6">
        <h2 className="text-lg font-semibold text-brand-linen">
          @{username} not found
        </h2>
        <p className="text-sm text-brand-linen/60">
          No Olio account is registered for this username on testnet.
        </p>
      </Card>
    );
  }

  return (
    <>
      <section className="grid gap-2 pt-4">
        <h1 className="text-3xl font-bold text-brand-linen">Pay @{username}</h1>
        <p className="text-sm text-brand-linen/65">
          Your payment becomes a confidential note only the recipient can
          discover and spend.
        </p>
      </section>

      <PayForm
        account={account}
        username={username}
        link={link === "loading" ? null : link}
      />

      <p className="pt-8 text-center text-xs text-brand-linen/50">
        Unlinkable receipt · encrypted to the recipient · Built on Stellar
      </p>
    </>
  );
}
