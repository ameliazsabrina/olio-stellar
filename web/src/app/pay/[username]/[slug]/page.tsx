"use client";

import { Loader } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "../../../../components/ui/card";
import { ToastFeedback } from "../../../../components/ui/toast-feedback";
import { usePaymentLinkBySlug } from "../../../../features/paymentLinks/hooks/usePaymentLink";
import { type OlioAccount, resolveUsername } from "../../../../lib/stellar";
import { PayForm } from "../PayForm";

export default function SlugPayPage() {
  const params = useParams<{ username: string; slug: string }>();
  const username = decodeURIComponent(params.username || "").toLowerCase();
  const slug = decodeURIComponent(params.slug || "").toLowerCase();
  const {
    link,
    loading: linkLoading,
    error: linkError,
    retry: retryLink,
  } = usePaymentLinkBySlug(username, slug);
  const [account, setAccount] = useState<OlioAccount | null | "loading">(
    "loading",
  );
  const [accountError, setAccountError] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    setAccount("loading");
    setAccountError(null);
    try {
      setAccount(await resolveUsername(username));
    } catch (error) {
      setAccount(null);
      setAccountError(
        error instanceof Error ? error.message : "Could not load this account.",
      );
    }
  }, [username]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  if (account === "loading" || linkLoading) {
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

  if (linkError) {
    return (
      <ToastFeedback
        title="Could not load payment link"
        message={linkError}
        variant="error"
        toastId="public-payment-link-error"
        action={{ label: "Try again", onClick: retryLink }}
      />
    );
  }

  if (accountError) {
    return (
      <ToastFeedback
        title="Could not load recipient"
        message={accountError}
        variant="error"
        toastId="public-recipient-error"
        action={{ label: "Try again", onClick: () => void loadAccount() }}
      />
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

  if (!link) {
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

  return (
    <>
      <section className="grid gap-2 pt-4">
        <h1 className="text-3xl font-bold text-brand-linen">Pay @{username}</h1>
        <p className="text-sm text-brand-linen/65">
          Your payment becomes a confidential note only the recipient can
          discover and spend.
        </p>
      </section>

      <PayForm account={account} username={username} link={link} />

      <p className="pt-8 text-center text-xs text-brand-linen/50">
        Unlinkable receipt · encrypted to the recipient · Built on Stellar
      </p>
    </>
  );
}
