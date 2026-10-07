"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { Check, LogOut, Moon, RotateCw, Sun, XIcon } from "lucide-react";
import { useWallet } from "../../components/WalletProvider";
import { useDashboardTheme } from "../../components/dashboard/DashboardBackground";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ToastFeedback } from "../../components/ui/toast-feedback";
import { trpc } from "../../trpc/react";
import { SIGN_IN_PATH } from "../../lib/auth-routes";
import { SumsubVerification } from "./SumsubVerification";
import { OPEN_VERIFICATION } from "./openVerification";
const steps = ["Profile", "Preparation", "Verification", "Submitted"];
const REFRESH_COOLDOWN_MS = 15_000;
type RefreshStatus = { firstSubmittedAt?: string | null };
function isThrottled(error: unknown): boolean {
  return (
    (error as { data?: { code?: string } } | null)?.data?.code ===
    "TOO_MANY_REQUESTS"
  );
}
export function VerificationController({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  // Remount all session state when the active account changes.
  return (
    <AccountVerification key={wallet.address}>{children}</AccountVerification>
  );
}
function AccountVerification({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const utils = trpc.useUtils();
  useEffect(() => {
    if (wallet.sessionReady && !wallet.authenticated)
      window.location.replace(SIGN_IN_PATH);
  }, [wallet.sessionReady, wallet.authenticated]);
  const ready =
    wallet.sessionReady &&
    wallet.authenticated &&
    !!wallet.address &&
    !!wallet.username &&
    wallet.accountUnlocked &&
    !wallet.connecting &&
    !wallet.pinModalOpen &&
    !wallet.usernameModalOpen;
  const [fresh, setFresh] = useState(false);
  const query = trpc.verification.onboarding.useQuery(
    { accountKey: wallet.address },
    {
      enabled: ready,
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: "always",
    },
  );
  useEffect(() => {
    if (ready) void query.refetch().then(() => setFresh(true));
  }, [ready]);
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);
  const selected = trpc.verification.status.useQuery(
    { businessId: selectedBusiness ?? "" },
    { enabled: ready && !!selectedBusiness, refetchOnWindowFocus: true },
  );
  const boundData = fresh ? query.data : undefined;
  const data =
    selectedBusiness && boundData?.submitted && selected.data
      ? {
          ...boundData,
          status: selected.data,
          business: {
            ...boundData.business!,
            businessId: selectedBusiness,
            type: selected.data.type,
            displayName: null,
          },
          submitted: !!selected.data.firstSubmittedAt,
        }
      : boundData;
  const [requested, setRequested] = useState(false);
  const [step, setStep] = useState(0);
  const [type, setType] = useState<"individual" | "company">("individual");
  const [displayName, setDisplayName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const previouslySubmitted = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!boundData) return;
    if (previouslySubmitted.current === false && boundData.submitted) {
      setRequested(true);
      setStep(3);
    }
    previouslySubmitted.current = boundData.submitted;
  }, [boundData?.submitted]);
  const businessId = data?.business?.businessId;
  const required = !boundData?.submitted;
  const open = ready && fresh && (required || requested);
  const savedDisplayName = data?.business?.displayName ?? "";
  const nameEditable = !!businessId && !selectedBusiness;
  useEffect(() => {
    if (nameEditable) setDisplayName(savedDisplayName);
  }, [nameEditable, savedDisplayName]);
  const create = trpc.businesses.create.useMutation();
  const rename = trpc.businesses.updateProfile.useMutation();
  const bind = trpc.businesses.bindAccount.useMutation();
  const start = trpc.verification.start.useMutation();
  const token = trpc.verification.sdkToken.useMutation();
  const refresh = trpc.verification.refresh.useMutation();
  const actionRef = useRef({ token, refresh, businessId });
  actionRef.current = { token, refresh, businessId };
  const getToken = useCallback(async () => {
    const { token, businessId } = actionRef.current;
    if (!businessId) throw new Error("Create your profile first.");
    return (await token.mutateAsync({ businessId })).token;
  }, []);
  // The server allows 6 refreshes per business per minute, and the SDK can
  // emit several status events in a burst, so share one in-flight call and
  // only hit the provider again after a cooldown unless the user asks.
  const inflight = useRef<Promise<RefreshStatus | null> | null>(null);
  const lastRefresh = useRef<{ at: number; status: RefreshStatus | null }>({
    at: 0,
    status: null,
  });
  const check = useCallback(
    (force = false) => {
      if (inflight.current) return inflight.current;
      const run = async () => {
        const { refresh, businessId } = actionRef.current;
        let status = lastRefresh.current.status;
        try {
          const due =
            force || Date.now() - lastRefresh.current.at >= REFRESH_COOLDOWN_MS;
          if (businessId && due) {
            status =
              (await refresh.mutateAsync({ businessId }))?.status ?? null;
            lastRefresh.current = { at: Date.now(), status };
          }
          setError("");
        } catch (e) {
          if (isThrottled(e)) {
            lastRefresh.current.at = Date.now();
            setError(
              force ? "Status was checked moments ago. Try again shortly." : "",
            );
          } else {
            setError("We could not confirm your status. Please retry.");
          }
        }
        // Webhook-driven updates still land through the cached queries.
        await utils.verification.onboarding.invalidate();
        await utils.verification.status.invalidate();
        return status;
      };
      inflight.current = run().finally(() => {
        inflight.current = null;
      });
      return inflight.current;
    },
    [utils],
  );
  const confirmSubmission = useCallback(() => {
    setRequested(true);
    setConfirming(true);
    void check();
  }, [check]);
  const [refreshing, setRefreshing] = useState(false);
  async function refreshStatus() {
    setRefreshing(true);
    try {
      const status = await check(true);
      // A provider-side submission the SDK never reported still lands on step 4.
      if (step === 2 && status?.firstSubmittedAt) {
        setConfirming(false);
        setStep(3);
      }
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    const show = (event?: Event) => {
      setSelectedBusiness((event as CustomEvent)?.detail?.businessId ?? null);
      setRequested(true);
      setStep(boundData?.submitted ? 3 : 0);
      void check();
    };
    window.addEventListener(OPEN_VERIFICATION, show);
    if (new URLSearchParams(window.location.search).has("verification")) {
      show();
      const url = new URL(window.location.href);
      url.searchParams.delete("verification");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    return () => window.removeEventListener(OPEN_VERIFICATION, show);
  }, [check, boundData?.submitted]);
  useEffect(() => {
    if (confirming && data?.submitted) {
      setStep(3);
      setConfirming(false);
      setRequested(true);
    }
  }, [confirming, data?.submitted]);
  useEffect(() => {
    if (open && businessId) void check();
  }, [open, businessId, check]);
  async function next() {
    setError("");
    try {
      if (step === 0) {
        if (!businessId) {
          const profile = await create.mutateAsync({
            type,
            displayName: displayName.trim() || null,
          });
          await bind.mutateAsync({ businessId: profile.businessId });
          await query.refetch();
        } else if (
          nameEditable &&
          displayName.trim() !== savedDisplayName.trim()
        ) {
          await rename.mutateAsync({
            businessId,
            displayName: displayName.trim() || null,
          });
          await query.refetch();
        }
        setStep(1);
      } else if (step === 1 && businessId) {
        await start.mutateAsync({ businessId });
        setStep(2);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    }
  }
  const busy =
    create.isPending || bind.isPending || rename.isPending || start.isPending;
  const { preference, setTheme } = useDashboardTheme();
  // Onboarding opens dark, matching the Figma frames, until the person picks a theme.
  const theme = preference ?? "dark";
  const isCompany = (data?.business?.type ?? type) === "company";
  const canGoBack = step > 0 && step < 3 && !confirming;
  const copy = [
    {
      title: data?.business
        ? `Your ${data.business.type} profile`
        : "Create your profile",
      description:
        "Submit your details once to start using Olio. You can use your dashboard while we review them.",
    },
    {
      title: "Get your documents ready",
      description: isCompany
        ? "Have your company registration documents and identification for owners and representatives ready."
        : "Have your government-issued ID ready. You may be asked to take a selfie.",
    },
    {
      title: `Verify your ${isCompany ? "company" : "identity"}`,
      description:
        "Documents and selfies go straight to our verification partner. This takes a few minutes.",
    },
    {
      title: "Submission received",
      description:
        "We are reviewing your details. You can use your dashboard in the meantime.",
    },
  ][step];
  return (
    <>
      {ready && fresh && boundData?.submitted ? (
        children
      ) : (
        <div role="status" className="py-16 text-center">
          Loading your data...
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !required) setRequested(false);
        }}
      >
        <DialogContent
          data-dashboard-theme={theme}
          showCloseButton={false}
          overlayClassName="bg-transparent bg-[linear-gradient(180deg,rgb(26_31_18/0.7)_0%,rgb(26_31_18/0.7)_40%,rgb(26_31_18/0.45)_70%,rgb(26_31_18/0.45)_100%)]"
          className="inset-0 top-0 left-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-transparent p-0 text-brand-linen ring-0 backdrop-blur-none sm:max-w-none sm:p-0 data-open:zoom-in-100 data-closed:zoom-out-100"
        >
          <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-4 sm:gap-4 sm:px-8 sm:pt-8">
            <Image
              src="/assets/olio-white.svg"
              alt="Olio"
              width={72}
              height={72}
              className="-my-3 size-16 shrink-0 sm:size-[4.5rem]"
            />
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() =>
                  setTheme(theme === "painting" ? "dark" : "painting")
                }
                aria-label={
                  theme === "painting"
                    ? "Use dark dashboard theme"
                    : "Use painting dashboard theme"
                }
                title={theme === "painting" ? "Use dark theme" : "Use painting"}
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/24 bg-brand-obsidian/45 text-brand-linen backdrop-blur-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
              >
                {theme === "painting" ? (
                  <Moon className="size-[18px]" aria-hidden="true" />
                ) : (
                  <Sun className="size-[18px]" aria-hidden="true" />
                )}
              </button>
              {!required ? (
                <DialogClose
                  render={
                    <button
                      type="button"
                      className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/24 bg-brand-obsidian/45 text-brand-linen backdrop-blur-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
                    />
                  }
                >
                  <XIcon className="size-[18px]" aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </DialogClose>
              ) : null}
            </div>
          </header>
          <div className="flex flex-1 items-start justify-center px-4 pt-2 pb-8 sm:items-center sm:px-8 sm:pb-16">
            <section
              className={`theme-linen surface-linen-panel relative flex w-full flex-col gap-3 rounded-[28px] p-5 text-(--control-foreground) sm:p-10 ${step === 2 && !confirming ? "max-w-2xl" : "max-w-[528px]"}`}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void refreshStatus()}
                disabled={refreshing || !businessId}
                aria-label={
                  refreshing ? "Refreshing submission status" : "Refresh status"
                }
                title="Refresh submission status"
                className="absolute top-4 right-4 rounded-full sm:top-[34px] sm:right-8"
              >
                <RotateCw
                  className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </Button>
              <ol
                aria-label="Verification progress"
                className="mr-10 flex items-center gap-2 text-[11px] leading-[15px]"
              >
                {steps.map((label, index) => {
                  const done = index < step;
                  const current = index === step;
                  const marker = (
                    <span
                      aria-hidden="true"
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                        current
                          ? "bg-(--control-foreground) text-(--control)"
                          : done
                            ? "bg-(--action) text-(--action-foreground)"
                            : "border border-(--control-border) bg-(--control) text-(--control-muted)"
                      }`}
                    >
                      {done ? (
                        <Check className="size-3" strokeWidth={2.5} />
                      ) : (
                        index + 1
                      )}
                    </span>
                  );
                  // Only the current step shows its name; the rest stay readable to screen readers.
                  const text = (
                    <span
                      className={`whitespace-nowrap ${current ? "font-medium text-(--control-foreground)" : "sr-only"}`}
                    >
                      {label}
                    </span>
                  );
                  return (
                    <li
                      key={label}
                      aria-current={current ? "step" : undefined}
                      className={`flex items-center gap-2 ${index > 0 ? "flex-1" : ""}`}
                    >
                      {index > 0 ? (
                        <span
                          aria-hidden="true"
                          className="h-px min-w-3 flex-1 bg-(--control-border)"
                        />
                      ) : null}
                      {done && canGoBack ? (
                        <button
                          type="button"
                          onClick={() => setStep(index)}
                          className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                        >
                          {marker}
                          {text}
                        </button>
                      ) : (
                        <>
                          {marker}
                          {text}
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="h-2" aria-hidden="true" />
              <DialogTitle className="text-[26px] leading-8 tracking-[-0.02em] sm:text-[30px] sm:leading-9">
                {copy.title}
              </DialogTitle>
              <DialogDescription className="max-w-none text-[13px] leading-[19px] text-(--control-muted)">
                {copy.description}
              </DialogDescription>
              <div className="h-2 sm:h-4" aria-hidden="true" />
              <ToastFeedback
                message={
                  selectedBusiness && selected.isError
                    ? "This verification is no longer available to your account."
                    : null
                }
                variant="error"
                toastId="verification-selected-error"
              />
              <ToastFeedback
                message={
                  query.isError
                    ? "Verification status is unavailable. Retry to continue."
                    : null
                }
                variant="error"
                toastId="verification-query-error"
              />
              <ToastFeedback
                message={
                  data && !data.serviceAvailable
                    ? "Verification is temporarily unavailable. Please retry shortly."
                    : null
                }
                variant="error"
                toastId="verification-service-unavailable"
              />
              <ToastFeedback
                message={error}
                variant="error"
                toastId="verification-error"
              />
              <div
                key={step}
                className="min-w-0 space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
              >
                {step === 0 &&
                  (data?.business ? (
                    <>
                      <p className="text-[13px] leading-[19px] text-(--control-muted)">
                        Profile type is locked.
                      </p>
                      {nameEditable ? (
                        <label className="grid gap-2 text-[13px] font-medium">
                          Display name (optional)
                          <Input
                            appearance="linen"
                            value={displayName}
                            maxLength={80}
                            disabled={busy}
                            onChange={(e) => setDisplayName(e.target.value)}
                          />
                        </label>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <fieldset disabled={busy} className="grid gap-2">
                        <legend className="mb-2 text-[13px] font-medium">
                          Profile type
                        </legend>
                        <div className="grid grid-cols-2 gap-2">
                          {(["individual", "company"] as const).map((value) => (
                            <label
                              key={value}
                              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-(--control-border) bg-(--control) px-3.5 py-2.5 text-sm capitalize transition-colors has-checked:border-(--control-foreground) has-focus-visible:ring-2 has-focus-visible:ring-ring/45"
                            >
                              <input
                                type="radio"
                                name="profile-type"
                                checked={type === value}
                                onChange={() => setType(value)}
                                className="accent-(--action)"
                              />
                              {value}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label className="grid gap-2 text-[13px] font-medium">
                        Display name (optional)
                        <Input
                          appearance="linen"
                          value={displayName}
                          maxLength={80}
                          onChange={(e) => setDisplayName(e.target.value)}
                        />
                      </label>
                    </>
                  ))}
                {step === 1 && (
                  <p className="rounded-xl border border-(--control-border) bg-(--control) px-3.5 py-3 text-xs leading-[17px] text-(--control-muted)">
                    Documents and selfies are collected by our verification
                    partner. Olio stores your verification status. Your public
                    badge is optional.
                  </p>
                )}
                {step === 2 &&
                  (confirming ? (
                    <p
                      role="status"
                      className="text-[13px] leading-[19px] text-(--control-muted)"
                    >
                      Confirming submission… We are waiting for server
                      confirmation. You can retry the status check.
                    </p>
                  ) : (
                    <SumsubVerification
                      appearance="linen"
                      theme={theme}
                      getToken={getToken}
                      onSubmitted={confirmSubmission}
                      onStatusChanged={(reviewed) =>
                        reviewed ? confirmSubmission() : void check()
                      }
                    />
                  ))}
                {step === 3 && (
                  <>
                    <p
                      role="status"
                      className="rounded-xl border border-(--control-border) bg-(--control) px-3.5 py-3 text-sm leading-[21px]"
                    >
                      {data?.status?.userMessage ??
                        "Your submission was received."}
                    </p>
                    {data?.status?.nextAction === "resubmit" ||
                    data?.status?.nextAction === "continue" ? (
                      <Button variant="secondary" onClick={() => setStep(2)}>
                        Provide additional information
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
              {step < 2 && (
                <Button
                  className="w-full"
                  disabled={busy || !data?.serviceAvailable}
                  onClick={() => void next()}
                >
                  {busy ? "Please wait…" : "Continue"}
                </Button>
              )}
              {step === 3 && (
                <Button
                  className="w-full"
                  onClick={() => setRequested(false)}
                  disabled={!data?.submitted}
                >
                  Continue to dashboard
                </Button>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                {canGoBack ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep(step - 1)}
                  >
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void wallet.disconnect()}
                >
                  <LogOut aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
