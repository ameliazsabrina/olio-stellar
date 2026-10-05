"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RotateCw } from "lucide-react";
import { useWallet } from "../../components/WalletProvider";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
            force ||
            Date.now() - lastRefresh.current.at >= REFRESH_COOLDOWN_MS;
          if (businessId && due) {
            status = (await refresh.mutateAsync({ businessId }))?.status ?? null;
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
  return (
    <>
      {ready && fresh && boundData?.submitted ? (
        children
      ) : (
        <div role="status" className="py-16 text-center">
          Complete account setup to access your dashboard.
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !required) setRequested(false);
        }}
      >
        <DialogContent
          size="lg"
          appearance="linen"
          showCloseButton={!required}
          className="sm:max-w-2xl"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refreshStatus()}
            disabled={refreshing || !businessId}
            aria-label={
              refreshing ? "Refreshing submission status" : "Refresh status"
            }
            title="Refresh submission status"
            className={`absolute top-3 rounded-full sm:top-4 ${required ? "right-3 sm:right-4" : "right-14 sm:right-15"}`}
          >
            <RotateCw
              className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
          <DialogTitle className={required ? "pr-12" : "pr-24"}>
            Verify your{" "}
            {data?.business?.type === "company" ? "company" : "identity"}
          </DialogTitle>
          <DialogDescription>
            Submit your details once to start using Olio. You can use your
            dashboard while we review them.
          </DialogDescription>
          <ol
            aria-label="Verification progress"
            className="grid grid-cols-4 gap-2 text-xs"
          >
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={`border-t-2 pt-2 ${step === index ? "border-foreground font-semibold" : "border-border text-muted-foreground"}`}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
          {selectedBusiness && selected.isError ? (
            <p role="alert">
              This verification is no longer available to your account.
            </p>
          ) : null}
          {query.isError ? (
            <p role="alert">
              Verification status is unavailable. Retry to continue.
            </p>
          ) : null}
          {data && !data.serviceAvailable ? (
            <p role="alert">
              Verification is temporarily unavailable. Please retry shortly.
            </p>
          ) : null}
          <div
            key={step}
            className="min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 space-y-4"
          >
            {step === 0 && (
              <>
                {data?.business ? (
                  <>
                    <p>
                      Your {data.business.type} profile. Profile type is locked.
                    </p>
                    {nameEditable ? (
                      <label className="block">
                        Display name (optional)
                        <Input
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
                    <fieldset disabled={busy}>
                      <legend className="mb-2 font-medium">Profile type</legend>
                      <div className="flex gap-6">
                        {(["individual", "company"] as const).map((value) => (
                          <label key={value} className="flex gap-2 capitalize">
                            <input
                              type="radio"
                              name="profile-type"
                              checked={type === value}
                              onChange={() => setType(value)}
                            />
                            {value}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label className="block">
                      Display name (optional)
                      <Input
                        value={displayName}
                        maxLength={80}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {step === 1 && (
              <>
                <p>
                  {(data?.business?.type ?? type) === "company"
                    ? "Have your company registration documents and identification for owners and representatives ready."
                    : "Have your government-issued ID ready. You may be asked to take a selfie."}
                </p>
                <p>
                  Documents and selfies are collected by our verification
                  partner. Olio stores your verification status. Your public
                  badge is optional.
                </p>
              </>
            )}
            {step === 2 &&
              (confirming ? (
                <p role="status">
                  Confirming submission… We are waiting for server confirmation.
                  You can retry the status check.
                </p>
              ) : (
                <SumsubVerification
                  appearance="linen"
                  getToken={getToken}
                  onSubmitted={confirmSubmission}
                  onStatusChanged={(reviewed) =>
                    reviewed ? confirmSubmission() : void check()
                  }
                />
              ))}
            {step === 3 && (
              <>
                <p role="status">
                  {data?.status?.userMessage ?? "Your submission was received."}
                </p>
                {data?.status?.nextAction === "resubmit" ||
                data?.status?.nextAction === "continue" ? (
                  <Button onClick={() => setStep(2)}>
                    Provide additional information
                  </Button>
                ) : null}
                <Button
                  onClick={() => setRequested(false)}
                  disabled={!data?.submitted}
                >
                  Continue to dashboard
                </Button>
              </>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {step > 0 && step < 3 && !confirming && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {step < 2 && (
              <Button
                disabled={busy || !data?.serviceAvailable}
                onClick={() => void next()}
              >
                {busy ? "Please wait…" : "Continue"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void wallet.disconnect()}>
              Sign out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
