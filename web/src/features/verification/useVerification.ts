"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouterOutputs } from "../../server/root";
import { useWallet } from "../../components/WalletProvider";
import { trpc } from "../../trpc/react";

export type BusinessSummary = RouterOutputs["businesses"]["mine"][number];
export type VerificationStatus = RouterOutputs["verification"]["status"];
export type BusinessType = BusinessSummary["type"];

export const ACTIVE_POLL_INTERVAL_MS = 15_000;
export const ACTIVE_POLL_WINDOW_MS = 10 * 60_000;

export function shouldPoll(
  status: VerificationStatus | undefined,
  submittedAt: number | null,
  now: number,
): boolean {
  if (!status || submittedAt === null) return false;
  if (now - submittedAt > ACTIVE_POLL_WINDOW_MS) return false;
  return (
    status.eligibility === "pending" ||
    status.eligibility === "not_started" ||
    status.providerStage === "submitted"
  );
}

export function useVerification() {
  const utils = trpc.useUtils();
  const businesses = trpc.businesses.mine.useQuery();
  const wallet = useWallet();
  const onboarding = trpc.verification.onboarding.useQuery(
    { accountKey: wallet.address },
    { enabled: !!wallet.address },
  );
  const business = onboarding.data?.business ?? null;
  const businessId = business?.businessId ?? null;
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const pollTimer = useRef<number | null>(null);

  const status = trpc.verification.status.useQuery(
    { businessId: businessId ?? "" },
    { enabled: businessId !== null },
  );

  const polling = shouldPoll(status.data, submittedAt, clock);
  const refetchRef = useRef(status.refetch);
  refetchRef.current = status.refetch;

  useEffect(() => {
    if (!polling) return;
    pollTimer.current = window.setInterval(() => {
      setClock(Date.now());
      void refetchRef.current();
    }, ACTIVE_POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, [polling]);

  const invalidate = useCallback(async () => {
    await Promise.all([
      utils.businesses.mine.invalidate(),
      utils.verification.onboarding.invalidate(),
      businessId
        ? utils.verification.status.invalidate({ businessId })
        : Promise.resolve(),
      businessId
        ? utils.passport.identity.invalidate({ businessId })
        : Promise.resolve(),
    ]);
  }, [utils, businessId]);

  const createBusiness = trpc.businesses.create.useMutation({
    onSuccess: () => invalidate(),
  });
  const bindAccount = trpc.businesses.bindAccount.useMutation({
    onSuccess: () => invalidate(),
  });
  const start = trpc.verification.start.useMutation({
    onSuccess: (next) => {
      if (businessId) utils.verification.status.setData({ businessId }, next);
    },
  });
  const sdkToken = trpc.verification.sdkToken.useMutation();
  const refresh = trpc.verification.refresh.useMutation({
    onSuccess: (result) => {
      if (businessId) {
        utils.verification.status.setData({ businessId }, result.status);
        void utils.passport.identity.invalidate({ businessId });
      }
    },
  });

  const sdkTokenRef = useRef(sdkToken);
  sdkTokenRef.current = sdkToken;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const requestToken = useCallback(async () => {
    if (!businessId) throw new Error("Create a business profile first.");
    const result = await sdkTokenRef.current.mutateAsync({ businessId });
    return result.token;
  }, [businessId]);

  const markSubmitted = useCallback(() => {
    setSubmittedAt(Date.now());
    setClock(Date.now());
  }, []);

  const requestRefresh = useCallback(async () => {
    if (!businessId) return;
    await refreshRef.current.mutateAsync({ businessId });
  }, [businessId]);

  return useMemo(
    () => ({
      business,
      businessId,
      businessesLoading: onboarding.isLoading,
      businessesError: businesses.error?.message ?? null,
      status: status.data ?? null,
      statusLoading: businessId !== null && status.isLoading,
      statusError: status.error?.message ?? null,
      polling,
      createBusiness,
      bindAccount,
      start,
      refresh,
      sdkToken,
      requestToken,
      requestRefresh,
      markSubmitted,
      reload: invalidate,
    }),
    [
      business,
      businessId,
      onboarding.isLoading,
      businesses.error,
      status.data,
      status.isLoading,
      status.error,
      polling,
      createBusiness,
      bindAccount,
      start,
      refresh,
      sdkToken,
      requestToken,
      requestRefresh,
      markSubmitted,
      invalidate,
    ],
  );
}
