"use client";

import { Loader } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardTheme } from "../../components/dashboard/DashboardBackground";
import { Button } from "../../components/ui/button";

const SumsubWebSdk = dynamic(() => import("@sumsub/websdk-react"), {
  ssr: false,
  loading: () => (
    <SdkPlaceholder label="Loading secure verification…" appearance="linen" />
  ),
});

export const SUBMISSION_EVENTS = [
  "idCheck.onApplicantSubmitted",
  "idCheck.onApplicantResubmitted",
  "idCheck.onActionSubmitted",
];

export const STATUS_EVENTS = ["idCheck.onApplicantStatusChanged"];

export function isSubmissionEvent(type: string): boolean {
  return SUBMISSION_EVENTS.includes(type);
}

export function isStatusEvent(type: string): boolean {
  return STATUS_EVENTS.includes(type);
}

type StatusPayload = {
  reviewStatus?: string;
  reviewResult?: { reviewAnswer?: string; reviewRejectType?: string };
};

// True once the applicant has left the "init" state (submitted, in review, or
// decided), except a RETRY rejection, which still needs the user's input.
export function isReviewedStatus(payload: unknown): boolean {
  const { reviewStatus, reviewResult } = (payload ?? {}) as StatusPayload;
  if (!reviewStatus || reviewStatus === "init") return false;
  return !(
    reviewResult?.reviewAnswer === "RED" &&
    reviewResult.reviewRejectType === "RETRY"
  );
}

function SdkPlaceholder({
  label,
  appearance = "glass",
}: {
  label: string;
  appearance?: "glass" | "linen";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-72 items-center justify-center gap-3 rounded-[1.5rem] text-sm ring-1 ${appearance === "linen" ? "bg-black/5 text-brand-obsidian ring-black/10" : "bg-brand-linen/8 text-brand-linen/80 ring-brand-linen/15"}`}
    >
      <Loader className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export type SumsubVerificationProps = {
  appearance?: "glass" | "linen";
  getToken: () => Promise<string>;
  onSubmitted: () => void;
  onStatusChanged: (reviewed: boolean) => void;
  onError?: (message: string) => void;
  language?: string;
};

export function SumsubVerification({
  getToken,
  onSubmitted,
  onStatusChanged,
  onError,
  language = "en",
  appearance = "glass",
}: SumsubVerificationProps) {
  const { theme } = useDashboardTheme();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const loadToken = useCallback(() => {
    setError(null);
    getToken()
      .then((value) => {
        if (!cancelled.current) setToken(value);
      })
      .catch((cause) => {
        if (cancelled.current) return;
        const message =
          cause instanceof Error
            ? cause.message
            : "We could not open the verification session.";
        setError(message);
        onError?.(message);
      });
  }, [getToken, onError]);

  useEffect(() => {
    cancelled.current = false;
    loadToken();
    return () => {
      cancelled.current = true;
    };
  }, [loadToken]);

  const expirationHandler = useCallback(() => getToken(), [getToken]);

  const handleMessage = useCallback(
    (type: string, payload: unknown) => {
      if (isSubmissionEvent(type)) onSubmitted();
      if (isStatusEvent(type)) onStatusChanged(isReviewedStatus(payload));
    },
    [onSubmitted, onStatusChanged],
  );

  const handleError = useCallback(
    (sdkError: { code?: string; error?: string; reason?: string }) => {
      const message =
        sdkError.reason ??
        sdkError.error ??
        "The verification session reported a problem.";
      setError(message);
      onError?.(message);
    },
    [onError],
  );

  if (error) {
    return (
      <div
        role="alert"
        className={`flex min-h-72 flex-col items-start justify-center gap-4 rounded-[1.5rem] p-6 text-sm ring-1 ${appearance === "linen" ? "bg-black/5 text-brand-obsidian ring-black/10" : "bg-brand-linen/8 text-brand-linen/85 ring-brand-linen/15"}`}
      >
        <p className="font-medium">
          The verification session could not be opened.
        </p>
        <p className="max-w-md opacity-70">{error}</p>
        <Button
          variant={appearance === "linen" ? "outline" : "glass"}
          onClick={loadToken}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!token)
    return (
      <SdkPlaceholder label="Preparing your session…" appearance={appearance} />
    );

  return (
    <div
      data-testid="sumsub-sdk-frame"
      className="min-w-0 max-w-full overflow-hidden rounded-[1.5rem] bg-white ring-1 ring-brand-linen/15"
    >
      <SumsubWebSdk
        accessToken={token}
        expirationHandler={expirationHandler}
        config={{
          lang: language,
          theme:
            appearance === "linen" || theme === "painting" ? "light" : "dark",
        }}
        options={{ adaptIframeHeight: true, addViewportTag: false }}
        onMessage={handleMessage}
        onError={handleError}
      />
    </div>
  );
}
