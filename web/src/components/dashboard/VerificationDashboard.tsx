"use client";

import { Loader } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import { SumsubVerification } from "../../features/verification/SumsubVerification";
import {
  type BusinessSummary,
  type BusinessType,
  useVerification,
  type VerificationStatus,
} from "../../features/verification/useVerification";
import { PASSPORT_PATH } from "../../lib/auth-routes";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { DashboardTile } from "./DashboardTile";
import {
  ACTION_LABELS,
  ELIGIBILITY_HEADLINES,
  ELIGIBILITY_LABELS,
  ELIGIBILITY_TONE,
  formatDateTime,
} from "./verificationCopy";

const TONE_VARIANT = {
  neutral: "muted",
  progress: "neutral",
  attention: "warning",
  success: "success",
  danger: "danger",
} as const;

export function EligibilityBadge({
  eligibility,
  className,
}: {
  eligibility: VerificationStatus["eligibility"];
  className?: string;
}) {
  return (
    <Badge
      variant={TONE_VARIANT[ELIGIBILITY_TONE[eligibility]]}
      className={className}
      data-eligibility={eligibility}
    >
      {ELIGIBILITY_LABELS[eligibility]}
    </Badge>
  );
}

export function VerificationDashboard() {
  const verification = useVerification();
  const [sessionOpen, setSessionOpen] = useState(false);
  const {
    business,
    status,
    statusLoading,
    businessesLoading,
    start,
    refresh,
    requestToken,
    requestRefresh,
    markSubmitted,
    polling,
  } = verification;

  const openSession = useCallback(async () => {
    if (!business) return;
    try {
      const next = await start.mutateAsync({ businessId: business.businessId });
      if (next.nextAction === "continue" || next.nextAction === "resubmit") {
        setSessionOpen(true);
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Verification could not be started.",
      );
    }
  }, [business, start]);

  const checkStatus = useCallback(async () => {
    try {
      await requestRefresh();
      toast.success("Status refreshed");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Status could not be refreshed.",
      );
    }
  }, [requestRefresh]);

  const onSubmitted = useCallback(() => {
    markSubmitted();
    void requestRefresh().catch(() => {});
    toast.success("Submitted. We will update your status once it is reviewed.");
  }, [markSubmitted, requestRefresh]);

  const onStatusChanged = useCallback(() => {
    void requestRefresh().catch(() => {});
  }, [requestRefresh]);

  const showSession =
    sessionOpen &&
    status !== null &&
    (status.nextAction === "continue" || status.nextAction === "resubmit");

  return (
    <>
      <DashboardPageHeader
        title="Verification"
        description="Verify your identity or company once. Olio keeps the result private until you choose to publish an Identity Verified badge."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 pb-16 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        <section
          className="min-w-0 lg:col-span-5"
          aria-labelledby="business-profile-heading"
        >
          {businessesLoading ? (
            <LoadingTile
              label="Loading your business profile"
              appearance="linen"
            />
          ) : business ? (
            <BusinessTile business={business} verification={verification} />
          ) : (
            <CreateBusinessTile verification={verification} />
          )}
        </section>

        <section
          className="min-w-0 lg:col-span-7"
          aria-labelledby="verification-status-heading"
        >
          {business && statusLoading ? (
            <LoadingTile
              label="Loading verification status"
              appearance="glass"
            />
          ) : (
            <StatusTile
              business={business}
              status={status}
              starting={start.isPending}
              refreshing={refresh.isPending}
              polling={polling}
              onStart={openSession}
              onCheck={checkStatus}
            />
          )}
        </section>

        {showSession ? (
          <section
            className="min-w-0 md:col-span-2 lg:col-span-12"
            aria-labelledby="verification-session-heading"
          >
            <DashboardTile
              appearance="glass"
              className="min-h-0 text-brand-linen"
              header={
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <h2
                    id="verification-session-heading"
                    className="dashboard-tile-title text-brand-linen"
                  >
                    Secure verification session
                  </h2>
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={() => setSessionOpen(false)}
                  >
                    Close session
                  </Button>
                </div>
              }
              content={
                <div className="mt-6">
                  <p className="mb-4 max-w-2xl text-sm leading-6 text-brand-linen/70">
                    Documents and selfies are collected by our verification
                    partner inside this secure frame. Olio never sees or stores
                    them.
                  </p>
                  <SumsubVerification
                    getToken={requestToken}
                    onSubmitted={onSubmitted}
                    onStatusChanged={onStatusChanged}
                  />
                </div>
              }
            />
          </section>
        ) : null}

        <section
          className="min-w-0 lg:col-span-5"
          aria-labelledby="verification-privacy-heading"
        >
          <PrivacyTile />
        </section>

        <section
          className="min-w-0 lg:col-span-7"
          aria-labelledby="verification-next-heading"
        >
          <NextStepsTile status={status} />
        </section>
      </div>
    </>
  );
}

function LoadingTile({
  label,
  appearance,
}: {
  label: string;
  appearance: "linen" | "glass";
}) {
  return (
    <DashboardTile
      appearance={appearance}
      className={cn(
        "min-h-[19rem]",
        appearance === "glass" && "text-brand-linen",
      )}
      content={
        <div
          role="status"
          aria-busy="true"
          aria-label={label}
          className="mt-2 space-y-3 motion-safe:animate-pulse"
        >
          <div className="h-8 w-48 rounded-lg bg-current/10" />
          <div className="h-4 w-72 max-w-full rounded-full bg-current/8" />
          <div className="h-4 w-56 max-w-full rounded-full bg-current/8" />
        </div>
      }
    />
  );
}

function CreateBusinessTile({
  verification,
}: {
  verification: ReturnType<typeof useVerification>;
}) {
  const [type, setType] = useState<BusinessType>("individual");
  const [displayName, setDisplayName] = useState("");
  const { createBusiness } = verification;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createBusiness.mutateAsync({
        type,
        displayName: displayName.trim() || null,
      });
      toast.success("Business profile created");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Profile could not be created.",
      );
    }
  }

  return (
    <DashboardTile
      appearance="linen"
      className="min-h-[19rem]"
      header={
        <h2 id="business-profile-heading" className="dashboard-tile-title">
          Who is being verified?
        </h2>
      }
      content={
        <form
          onSubmit={submit}
          className="mt-6 space-y-5"
          aria-describedby="business-type-help"
        >
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Profile type</legend>
            <p
              id="business-type-help"
              className="text-sm text-muted-foreground"
            >
              Individuals verify themselves. Companies verify the business and
              its owners or representatives.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["individual", "Individual", "Just me"],
                  ["company", "Company", "A registered business"],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-2xl border px-4 py-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
                    type === value
                      ? "border-foreground/40 bg-foreground/8"
                      : "border-border bg-card/40 hover:bg-card/70",
                  )}
                >
                  <input
                    type="radio"
                    name="business-type"
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                    className="sr-only"
                  />
                  <span className="font-semibold">{label}</span>
                  <span className="text-muted-foreground">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="business-display-name">
              Display name (optional)
            </Label>
            <Input
              id="business-display-name"
              appearance="linen"
              value={displayName}
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Shown on your public badge if you publish it"
            />
          </div>
          <Button
            type="submit"
            disabled={createBusiness.isPending}
            aria-busy={createBusiness.isPending}
          >
            {createBusiness.isPending ? (
              <Loader className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {createBusiness.isPending ? "Creating…" : "Create profile"}
          </Button>
        </form>
      }
    />
  );
}

function BusinessTile({
  business,
  verification,
}: {
  business: BusinessSummary;
  verification: ReturnType<typeof useVerification>;
}) {
  const { bindAccount } = verification;

  async function bind() {
    try {
      const result = await bindAccount.mutateAsync({
        businessId: business.businessId,
      });
      toast.success(
        result.changed ? "Account linked" : "Account link is up to date",
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Account could not be linked.",
      );
    }
  }

  return (
    <DashboardTile
      appearance="linen"
      className="min-h-[19rem]"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="business-profile-heading" className="dashboard-tile-title">
            {business.type === "company"
              ? "Company profile"
              : "Individual profile"}
          </h2>
          <Badge variant="outline">{business.role}</Badge>
        </div>
      }
      content={
        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Display name</dt>
            <dd className="mt-1 font-heading text-2xl font-semibold tracking-tight">
              {business.displayName ?? "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Linked Olio account</dt>
            <dd className="mt-1 font-medium">
              {business.accountBound
                ? business.username
                  ? `@${business.username}`
                  : "Linked (no handle yet)"
                : "Not linked"}
            </dd>
          </div>
        </dl>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Verification attaches to the Olio account that owns this profile.
          </p>
          {!business.accountBound || !business.username ? (
            <Button
              variant="outline"
              size="sm"
              onClick={bind}
              disabled={bindAccount.isPending}
              aria-busy={bindAccount.isPending}
            >
              {bindAccount.isPending ? "Linking…" : "Link my account"}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

function StatusTile({
  business,
  status,
  starting,
  refreshing,
  polling,
  onStart,
  onCheck,
}: {
  business: BusinessSummary | null;
  status: VerificationStatus | null;
  starting: boolean;
  refreshing: boolean;
  polling: boolean;
  onStart: () => void;
  onCheck: () => void;
}) {
  const eligibility = status?.eligibility ?? "not_started";
  const nextAction = business
    ? (status?.nextAction ?? "start")
    : "create_business";
  const canAct =
    business !== null &&
    status !== null &&
    (nextAction === "start" ||
      nextAction === "continue" ||
      nextAction === "resubmit") &&
    status.canStart;

  return (
    <DashboardTile
      appearance="glass"
      className="min-h-[19rem] text-brand-linen"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2
            id="verification-status-heading"
            className="dashboard-tile-title text-brand-linen"
          >
            Verification status
          </h2>
          <EligibilityBadge eligibility={eligibility} />
        </div>
      }
      content={
        <div className="mt-6 max-w-xl">
          <p
            className="font-heading text-3xl font-semibold tracking-tight"
            data-testid="status-headline"
          >
            {business
              ? ELIGIBILITY_HEADLINES[eligibility]
              : "Create a profile to begin"}
          </p>
          <p
            className="mt-4 text-sm leading-6 text-brand-linen/70"
            data-testid="status-message"
          >
            {status?.userMessage ??
              (business
                ? "Verification takes a few minutes. Have your ID ready, and for a company, registration details for its owners."
                : "Tell us whether you are verifying yourself or a company.")}
          </p>
          {status ? (
            <dl className="mt-5 grid gap-x-6 gap-y-2 text-xs text-brand-linen/60 sm:grid-cols-2">
              <div>
                <dt>Last checked</dt>
                <dd className="text-brand-linen/85">
                  {formatDateTime(status.checkedAt)}
                </dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd className="text-brand-linen/85">
                  {status.environment ? status.environment : "Not configured"}
                  {polling ? " · watching for updates" : ""}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-3">
          {canAct ? (
            <Button
              variant="glass"
              onClick={onStart}
              disabled={starting}
              aria-busy={starting}
            >
              {starting ? (
                <Loader className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {starting ? "Opening…" : ACTION_LABELS[nextAction]}
            </Button>
          ) : null}
          {business && status && nextAction === "done" ? (
            <Link
              href={PASSPORT_PATH}
              className="inline-flex h-10 items-center rounded-full bg-brand-linen px-4 text-sm font-semibold text-brand-obsidian focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen focus-visible:ring-offset-2 focus-visible:ring-offset-brand-obsidian"
            >
              {ACTION_LABELS.done}
            </Link>
          ) : null}
          {business &&
          status &&
          status.mode !== "off" &&
          nextAction !== "start" ? (
            <Button
              variant="glass"
              onClick={onCheck}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              {refreshing ? (
                <Loader className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {refreshing ? "Checking…" : "Check status"}
            </Button>
          ) : null}
          {business &&
          status &&
          !status.canStart &&
          eligibility !== "approved" &&
          status.mode !== "off" &&
          !business.accountBound ? (
            <p className="text-xs text-brand-linen/60">
              Link your Olio account to start.
            </p>
          ) : null}
        </div>
      }
    />
  );
}

function PrivacyTile() {
  return (
    <DashboardTile
      appearance="linen"
      className="min-h-[16rem]"
      header={
        <h2 id="verification-privacy-heading" className="dashboard-tile-title">
          What stays private
        </h2>
      }
      content={
        <ul className="mt-6 space-y-3 text-sm leading-6 text-muted-foreground">
          <li>
            Documents and selfies go to our verification partner, not Olio.
          </li>
          <li>Your balance, notes and payment history are never shared.</li>
          <li>
            Nothing is published until you turn on your badge in Passport.
          </li>
        </ul>
      }
    />
  );
}

function NextStepsTile({ status }: { status: VerificationStatus | null }) {
  const steps = [
    "Create your profile and link your Olio account.",
    "Complete the secure session with your ID or company documents.",
    "We check the result against Olio's policy and record the outcome.",
    "Decide whether to publish an Identity Verified badge.",
  ];
  const activeIndex = !status
    ? 0
    : status.eligibility === "approved"
      ? 3
      : status.eligibility === "not_started"
        ? status.providerStage === "not_started"
          ? 0
          : 1
        : 2;
  return (
    <DashboardTile
      appearance="glass"
      className="min-h-[16rem] text-brand-linen"
      header={
        <h2
          id="verification-next-heading"
          className="dashboard-tile-title text-brand-linen"
        >
          How it works
        </h2>
      }
      content={
        <ol className="mt-6 space-y-3 text-sm leading-6">
          {steps.map((step, index) => (
            <li
              key={step}
              className={cn(
                "flex gap-3",
                index === activeIndex
                  ? "text-brand-linen"
                  : "text-brand-linen/60",
              )}
              aria-current={index === activeIndex ? "step" : undefined}
            >
              <span className="font-mono text-xs tabular-nums pt-1">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      }
      footer={
        <p className="text-xs text-brand-linen/75">
          Policy version {status?.policyVersion ?? 1}. Approval is decided by
          Olio's server after the provider result is checked, never by this
          page.
        </p>
      }
    />
  );
}
