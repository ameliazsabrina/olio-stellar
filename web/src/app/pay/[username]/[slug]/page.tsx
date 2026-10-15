"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ToastFeedback } from "../../../../components/ui/toast-feedback";
import { usePaymentLinkBySlug } from "../../../../features/paymentLinks/hooks/usePaymentLink";
import { type OlioAccount, resolveUsername } from "../../../../lib/stellar";
import { PayContent } from "../PayContent";
import { PayLoading, PayNotice } from "../PayStates";

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
    return <PayLoading />;
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
      <PayNotice title={`@${username} not found`}>
        No Olio account is registered for this username on testnet.
      </PayNotice>
    );
  }

  if (!link) {
    return (
      <PayNotice title="Payment link unavailable">
        This link may have been archived, deleted, or mistyped.
      </PayNotice>
    );
  }

  return <PayContent account={account} username={username} link={link} />;
}
