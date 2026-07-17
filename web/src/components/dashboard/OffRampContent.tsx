"use client";

import {
  Banknote,
  Check,
  ExternalLink,
  Landmark,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type AnchorInfo,
  anchorHomeDomain,
  authenticate,
  fetchAnchorInfo,
  fetchWithdrawLimits,
  pollSep24Until,
  type Sep24Transaction,
  sendWithdrawalPayment,
  startInteractiveWithdraw,
  type WithdrawLimits,
} from "../../lib/anchor";
import { fromBaseUnits, toBaseUnits } from "../../lib/crypto";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import {
  type Bridge,
  clearPersistedBridge,
  createBridge,
  persistBridge,
  provisionBridge,
  releaseNoteToBridge,
} from "../../lib/offramp";
import { claimableNotes } from "../../lib/withdraw";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";

type Step = "select" | "preparing" | "interactive" | "settling" | "done";

const PREP_LABEL: Record<string, string> = {
  fund: "Preparing a one-time payout account…",
  release: "Releasing your payment from the shielded pool…",
  auth: "Connecting to the anchor…",
  init: "Opening the withdrawal…",
};

function anchorLabel(): string {
  try {
    return new URL(anchorHomeDomain).hostname;
  } catch {
    return anchorHomeDomain;
  }
}

function paintAnchorWindow(
  win: Window | null,
  title: string,
  body: string,
): void {
  if (!win || win.closed) return;
  try {
    win.document.title = title;
    win.document.body.style.cssText =
      "margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#0e0f0d;color:#fff;";
    win.document.body.innerHTML = `<div style="max-width:22rem;padding:2rem;text-align:center;line-height:1.5">
      <p style="font-size:0.95rem;font-weight:600;margin:0 0 0.5rem">${title}</p>
      <p style="font-size:0.85rem;color:rgba(255,255,255,0.65);margin:0">${body}</p>
    </div>`;
  } catch {}
}

export function OffRampContent({
  notes,
  onBusyChange,
}: {
  notes: MyNote[];
  onBusyChange?: (busy: boolean) => void;
}) {
  const { getSigner } = useWallet();
  const [step, setStep] = useState<Step>("select");
  const [prepPhase, setPrepPhase] = useState<string>("fund");
  const [selectedLeaf, setSelectedLeaf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live off-ramp session state, populated as the flow advances.
  const [interactive, setInteractive] = useState<{
    info: AnchorInfo;
    token: string;
    id: string;
    url: string;
  } | null>(null);
  const [settled, setSettled] = useState<Sep24Transaction | null>(null);

  const [limits, setLimits] = useState<WithdrawLimits | null>(null);

  const options = useMemo(() => claimableNotes(notes), [notes]);

  const { minUnits, maxUnits } = useMemo(
    () => ({
      minUnits: limits?.min != null ? toBaseUnits(String(limits.min)) : null,
      maxUnits: limits?.max != null ? toBaseUnits(String(limits.max)) : null,
    }),
    [limits],
  );

  const limitIssue = useMemo(
    () =>
      (amount: bigint): "over" | "under" | null => {
        if (maxUnits != null && amount > maxUnits) return "over";
        if (minUnits != null && amount < minUnits) return "under";
        return null;
      },
    [minUnits, maxUnits],
  );

  const selected = options.find((n) => n.leafIndex === selectedLeaf) ?? null;
  const selectedIssue = selected ? limitIssue(selected.amount) : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchAnchorInfo();
        const l = await fetchWithdrawLimits(info);
        if (!cancelled) setLimits(l);
      } catch {
        // Non-fatal: without limits we just skip the client-side pre-check.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onBusyChange?.(step !== "select");
  }, [step, onBusyChange]);

  useEffect(() => {
    if (options.length === 0) {
      setSelectedLeaf(null);
      return;
    }

    if (options.some((n) => n.leafIndex === selectedLeaf)) return;
    const firstEligible = options.find((n) => limitIssue(n.amount) === null);
    setSelectedLeaf((firstEligible ?? options[0]).leafIndex);
  }, [options, selectedLeaf, limitIssue]);

  async function start() {
    if (!selected) {
      setError("Select a payment to cash out.");
      return;
    }
    // Pre-flight against the anchor's advertised limits so we never provision a
    // bridge account (and spend gas) for a withdrawal the anchor will reject.
    const issue = limitIssue(selected.amount);
    if (issue === "over") {
      setError(
        `This payment is ${fromBaseUnits(selected.amount)} USDC, above ${anchorLabel()}'s ${limits?.max} USDC per-withdrawal limit. Cash out a smaller payment.`,
      );
      return;
    }
    if (issue === "under") {
      setError(
        `This payment is below ${anchorLabel()}'s ${limits?.min} USDC minimum withdrawal.`,
      );
      return;
    }
    setError(null);
    setStep("preparing");
    // Open the anchor window synchronously inside the click gesture, otherwise
    // the post-await window.open below is treated as programmatic and blocked.
    // Navigated to the interactive URL once it's ready; closed on failure. If a
    // pop-up blocker nulls this out, the "interactive" step's button is fallback.
    const anchorWindow =
      typeof window !== "undefined" ? window.open("", "_blank") : null;
    paintAnchorWindow(
      anchorWindow,
      "Preparing your secure withdrawal…",
      "This tab will redirect to the anchor automatically once your zero-knowledge proof is ready. Keep it open.",
    );
    // Track whether the note has actually been spent to the bridge. Until it
    // has, any failure is harmless — nothing has left the shielded pool. This
    // is the whole point of the ordering below.
    const bridge: Bridge = createBridge();
    let released = false;
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const amount = fromBaseUnits(selected.amount);

      // 1 · one-time bridge account (XLM + trustline). No funds move yet.
      setPrepPhase("fund");
      await provisionBridge(bridge);

      // 2 · SEP-10 auth + open the interactive withdrawal, then redirect the
      // user to the anchor — all BEFORE spending the note, so a failure or an
      // abandoned KYC never strands funds.
      setPrepPhase("auth");
      const info = await fetchAnchorInfo();
      const token = await authenticate(info, bridge.keypair);
      setPrepPhase("init");
      const { id, url } = await startInteractiveWithdraw(
        info,
        token,
        bridge.publicKey,
        amount,
      );
      if (anchorWindow && !anchorWindow.closed)
        anchorWindow.location.href = url;
      setInteractive({ info, token, id, url });
      setStep("interactive");

      // 3 · wait for the user to finish KYC/bank details in the anchor window.
      const ready = await pollSep24Until(
        info,
        token,
        id,
        (tx) =>
          tx.status === "pending_user_transfer_start" ||
          tx.status === "completed",
      );

      // 4 · only NOW, once the anchor is ready for the payment, release the note
      // into the bridge and settle. Re-scan for the freshest Merkle root (the
      // pool keeps a 30-root history, so the KYC wait can't stale the proof).
      if (ready.status !== "completed") {
        setStep("settling");
        const scan = await scanMyNotes(acct);
        const note = scan.notes.find(
          (n) => n.leafIndex === selected.leafIndex && !n.spent,
        );
        if (!note) throw new Error("That payment is no longer available.");
        // Persist the bridge secret BEFORE spending, so an interrupted settle
        // leaves the funds recoverable instead of stranded on a lost key.
        persistBridge(bridge, id, note.amount);
        await releaseNoteToBridge({
          signer: getSigner(),
          acct,
          scan,
          note,
          bridge,
        });
        released = true;
        await sendWithdrawalPayment(bridge.keypair, ready);
      }

      const final = await pollSep24Until(
        info,
        token,
        id,
        (tx) => tx.status === "completed",
      );
      // Settled end-to-end — the bridge is drained, drop the recovery record.
      clearPersistedBridge(id);
      setSettled(final);
      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Off-ramp failed.";
      // Surface the failure IN the pre-opened tab instead of leaving a blank
      // window (or silently closing it), so the cause is visible.
      paintAnchorWindow(anchorWindow, "Withdrawal couldn't be prepared", msg);
      // If the note was already spent, the funds sit on the (persisted) bridge
      // account — say so rather than implying the money is simply gone.
      setError(
        released
          ? `${msg} Your USDC is safe on a recovery account and can be reclaimed — it has not been lost.`
          : msg,
      );
      setStep("select");
    }
  }

  if (options.length === 0) {
    return (
      <ToastFeedback
        message="No payments to cash out yet. Share your pay link to receive your first private payment."
        toastId="off-ramp-empty"
      />
    );
  }

  if (step === "select") {
    return (
      <div className="grid gap-4">
        <div className="flex items-start gap-2 rounded-lg bg-white/8 px-3 py-2.5 text-xs text-white/70 ring-1 ring-white/12">
          <Landmark className="mt-0.5 size-4 shrink-0 text-white/70" />
          <span>
            Cash out to your bank through{" "}
            <b className="font-semibold text-white">{anchorLabel()}</b>.
            Identity and bank details are handled by the anchor — they never
            touch Olio.
          </span>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-white">
            Payment to cash out
          </legend>
          <div className="grid gap-2">
            {options.map((note) => {
              const active = note.leafIndex === selectedLeaf;
              const issue = limitIssue(note.amount);
              return (
                <button
                  key={note.leafIndex}
                  type="button"
                  onClick={() => setSelectedLeaf(note.leafIndex)}
                  aria-pressed={active}
                  className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-white/70 ${
                    active
                      ? "border-white/40 bg-white/16"
                      : "border-white/15 bg-white/7 hover:border-white/25 hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm text-white">
                    <span
                      className={`grid size-5 place-items-center rounded-full border ${
                        active
                          ? "border-white bg-white text-ink"
                          : "border-white/35"
                      }`}
                      aria-hidden="true"
                    >
                      {active && <Check className="size-3" />}
                    </span>
                    Payment
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-sm font-semibold text-white tabular-nums">
                      {fromBaseUnits(note.amount)} USDC
                    </span>
                    {issue ? (
                      <span className="text-[0.7rem] font-medium text-amber-300/90">
                        {issue === "over"
                          ? `Over ${limits?.max} USDC anchor limit`
                          : `Below ${limits?.min} USDC minimum`}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-white/60">
            Each payment is cashed out in full. To move a smaller amount,
            receive it as a separate payment.
          </p>
        </fieldset>

        {error ? (
          <Alert appearance="glass" variant="destructive">
            <AlertTitle>Withdrawal not completed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          variant="glass"
          className="min-h-11"
          size="lg"
          onClick={start}
          disabled={!!selectedIssue}
        >
          <Banknote className="size-4" aria-hidden="true" />
          Continue to bank
        </Button>
      </div>
    );
  }

  if (step === "preparing") {
    return (
      <div className="grid place-items-center gap-3 py-8 text-center">
        <Loader2
          className="size-8 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div className="text-sm font-semibold text-white">
          {PREP_LABEL[prepPhase] ?? "Preparing…"}
        </div>
        <div className="max-w-sm text-sm text-white/65">
          A zero-knowledge proof is generated in your browser before any funds
          move. This can take a few seconds.
        </div>
      </div>
    );
  }

  if (step === "interactive" && interactive) {
    return (
      <div className="grid gap-4">
        <div className="rounded-lg bg-white/8 p-4 text-sm ring-1 ring-white/15">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-white/60">Cashing out</span>
            <span className="font-heading text-2xl font-semibold text-white">
              {selected ? fromBaseUnits(selected.amount) : ""} USDC
            </span>
          </div>
        </div>
        <p className="text-sm text-white/65">
          Finish in the secure {anchorLabel()} window: verify your identity and
          enter where the cash should land. This screen updates automatically
          once you're done.
        </p>
        <Button
          variant="glass"
          className="min-h-11"
          size="lg"
          nativeButton={false}
          render={
            <a
              href={interactive.url}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open secure {anchorLabel()} window
        </Button>
        <div className="flex items-center justify-center gap-2 text-xs text-white/60">
          <Loader2
            className="size-3.5 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Waiting for the anchor…
        </div>
      </div>
    );
  }

  if (step === "settling") {
    return (
      <div className="grid place-items-center gap-3 py-8 text-center">
        <Loader2
          className="size-8 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div className="text-sm font-semibold text-white">
          Sending your payout to the anchor…
        </div>
        <div className="max-w-sm text-sm text-white/65">
          Completing the on-chain transfer. Hang tight.
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="grid place-items-center gap-4 py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-ok/20 text-emerald-100 ring-1 ring-ok/40">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-semibold text-white">
            Cash-out submitted
          </h2>
          <p className="max-w-md text-sm text-white/65">
            {settled?.amount_out
              ? `${settled.amount_out} on its way to your bank via ${anchorLabel()}.`
              : `Your withdrawal is being processed by ${anchorLabel()}.`}{" "}
            Track it in the anchor window.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
