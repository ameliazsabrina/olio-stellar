"use client";

import {
  Banknote,
  ExternalLink,
  Landmark,
  Loader,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type AnchorInfo,
  anchorHomeDomain,
  authenticate,
  fetchAnchorInfo,
  fetchWithdrawLimits,
  pollSep24Until,
  Sep24PollTimeoutError,
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
import { Button } from "../ui/button";
import { glassInsetClass } from "../ui/glass";
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
      'margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Aileron",system-ui,-apple-system,sans-serif;background:#0e0f0d;color:#fff;';
    win.document.body.innerHTML = `<div style="max-width:22rem;padding:2rem;text-align:center;line-height:1.5">
      <p style="font-size:0.95rem;font-weight:600;margin:0 0 0.5rem">${title}</p>
      <p style="font-size:0.85rem;color:rgba(255,255,255,0.65);margin:0">${body}</p>
    </div>`;
  } catch {}
}

export function OffRampContent({
  note,
  onBusyChange,
  onComplete,
}: {
  note: MyNote;
  onBusyChange?: (busy: boolean) => void;
  onComplete?: () => void | Promise<void>;
}) {
  const { getSigner } = useWallet();
  const [step, setStep] = useState<Step>("select");
  const [prepPhase, setPrepPhase] = useState<string>("fund");
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
    onBusyChange?.(step !== "select" && step !== "done");
  }, [step, onBusyChange]);

  async function start() {
    // Pre-flight against the anchor's advertised limits so we never provision a
    // bridge account (and spend gas) for a withdrawal the anchor will reject.
    // Surfaced as a toast on the withdraw attempt rather than blocking the note.
    const issue = limitIssue(note.amount);
    if (issue === "over") {
      toast.error(
        `This payment is ${fromBaseUnits(note.amount)} USDC, above ${anchorLabel()}'s ${limits?.max} USDC per-withdrawal limit. Cash out a smaller payment.`,
        { id: "off-ramp-limit" },
      );
      return;
    }
    if (issue === "under") {
      toast.error(
        `This payment is below ${anchorLabel()}'s ${limits?.min} USDC minimum withdrawal.`,
        { id: "off-ramp-limit" },
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
    let paymentSent = false;
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const amount = fromBaseUnits(note.amount);

      // 1 · verify the configured anchor before spending sponsor XLM.
      const info = await fetchAnchorInfo();

      // 2 · one-time bridge account (XLM + trustline). No USDC moves yet.
      setPrepPhase("fund");
      await provisionBridge(bridge);

      // 3 · SEP-10 auth + open the interactive withdrawal, then redirect the
      // user to the anchor — all BEFORE spending the note, so a failure or an
      // abandoned KYC never strands funds.
      setPrepPhase("auth");
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

      // 4 · wait for the user to finish KYC/pickup details in the anchor window.
      const ready = await pollSep24Until(
        info,
        token,
        id,
        (tx) =>
          tx.status === "pending_user_transfer_start" ||
          tx.status === "completed",
      );

      // 5 · only NOW, once the anchor is ready for the payment, release the note
      // into the bridge and settle. Re-scan for the freshest Merkle root (the
      // pool keeps a 30-root history, so the KYC wait can't stale the proof).
      if (ready.status !== "completed") {
        if (!ready.amount_in || toBaseUnits(ready.amount_in) !== note.amount) {
          throw new Error(
            "Anchor payment instructions do not match the selected amount.",
          );
        }
        setStep("settling");
        const scan = await scanMyNotes(acct);
        const currentNote = scan.notes.find(
          (n) => n.leafIndex === note.leafIndex && !n.spent,
        );
        if (!currentNote)
          throw new Error("That payment is no longer available.");
        // Persist the bridge secret BEFORE spending, so an interrupted settle
        // leaves the funds recoverable instead of stranded on a lost key.
        persistBridge(bridge, id, currentNote.amount);
        await releaseNoteToBridge({
          signer: getSigner(),
          acct,
          scan,
          note: currentNote,
          bridge,
        });
        released = true;
        await sendWithdrawalPayment(bridge.keypair, ready);
        paymentSent = true;
      }

      let final: Sep24Transaction;
      try {
        final = await pollSep24Until(
          info,
          token,
          id,
          (tx) =>
            tx.status === "pending_user_transfer_complete" ||
            tx.status === "completed",
        );
      } catch (pollError) {
        // The on-chain payment is final even if the anchor takes longer to
        // publish a pickup reference. Show a submitted state without pretending
        // the cash pickup has completed.
        if (paymentSent && pollError instanceof Sep24PollTimeoutError) {
          final = pollError.lastTransaction;
        } else {
          throw pollError;
        }
      }
      // The bridge was drained by the successful anchor payment. A later cash
      // pickup is tracked by the SEP-24 transaction, not by the bridge secret.
      clearPersistedBridge(id);
      setSettled(final);
      setStep("done");
      await onComplete?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Off-ramp failed.";
      // Surface the failure IN the pre-opened tab instead of leaving a blank
      // window (or silently closing it), so the cause is visible.
      paintAnchorWindow(anchorWindow, "Withdrawal couldn't be prepared", msg);
      // If the note was already spent, the funds sit on the (persisted) bridge
      // account — say so rather than implying the money is simply gone.
      setError(
        released
          ? paymentSent
            ? `${msg} The Stellar payment was already sent to the anchor; reopen the anchor window and check the withdrawal status.`
            : `${msg} Your USDC is safe on a recovery account and can be reclaimed — it has not been lost.`
          : msg,
      );
      setStep("select");
    }
  }

  if (step === "select") {
    return (
      <div className="grid gap-4">
        <div
          className={`${glassInsetClass} flex items-start gap-2 px-3 py-2.5 text-xs text-white/70`}
        >
          <Landmark className="mt-0.5 size-4 shrink-0 text-white/70" />
          <span>
            Cash out as local currency through{" "}
            <b className="font-semibold text-white">{anchorLabel()}</b>.
            Identity and pickup details are handled by the anchor — they never
            touch Olio.
          </span>
        </div>

        <div className={`${glassInsetClass} p-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-white/60">Cashing out</span>
            <span className="font-mono text-xl font-semibold text-white tabular-nums">
              {fromBaseUnits(note.amount)} USDC
            </span>
          </div>
        </div>

        <ToastFeedback
          title="Withdrawal not completed"
          message={error}
          variant="error"
          toastId="off-ramp-error"
        />

        <Button variant="glass" className="min-h-11" size="lg" onClick={start}>
          <Banknote className="size-4" aria-hidden="true" />
          Continue to cash-out
        </Button>
      </div>
    );
  }

  if (step === "preparing") {
    return (
      <div className="grid place-items-center gap-3 py-8 text-center">
        <div className="flex items-center justify-center gap-3">
          <Loader
            className="size-8 motion-safe:animate-spin"
            aria-hidden="true"
          />
          <div className="text-sm font-semibold text-white">
            {PREP_LABEL[prepPhase] ?? "Preparing…"}
          </div>
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
        <div className={`${glassInsetClass} p-4 text-sm`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-white/60">Cashing out</span>
            <span className="font-mono text-xl font-semibold text-white tabular-nums">
              {fromBaseUnits(note.amount)} USDC
            </span>
          </div>
        </div>
        <p className="text-sm text-white/65">
          Finish in the secure {anchorLabel()} window: verify your identity and
          choose where to collect your cash. This screen updates automatically
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
          <Loader
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
        <div className="flex items-center justify-center gap-3">
          <Loader
            className="size-8 motion-safe:animate-spin"
            aria-hidden="true"
          />
          <div className="text-sm font-semibold text-white">
            Sending your payout to the anchor…
          </div>
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
            {settled?.status === "completed"
              ? `Your withdrawal through ${anchorLabel()} is complete.`
              : settled?.external_transaction_id
                ? `Show reference ${settled.external_transaction_id} when collecting your cash.`
                : `Your Stellar payment was submitted to ${anchorLabel()}. Open the anchor status page for pickup details.`}
          </p>
          {settled?.more_info_url ? (
            <Button
              variant="glass"
              nativeButton={false}
              render={
                <a
                  href={settled.more_info_url}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              View cash-out status
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}
