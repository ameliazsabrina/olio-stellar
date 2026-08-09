"use client";

import { Building2, Check, Loader, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sendUsdcPayment } from "../../lib/anchor";
import { fromBaseUnits } from "../../lib/crypto";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import {
  type Bridge,
  clearPersistedBridge,
  createBridge,
  persistBridge,
  provisionBridge,
  releaseNoteToBridge,
} from "../../lib/offramp";
import {
  hasDepositInstructions,
  isCompleted,
  openTransakOffRamp,
  pollTransakOrderUntil,
  type TransakOrder,
  type TransakSession,
  transakMemo,
} from "../../lib/transak";
import { claimableNotes } from "../../lib/withdraw";
import { Button } from "../ui/button";
import { glassInsetClass } from "../ui/glass";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";

type Step = "select" | "preparing" | "interactive" | "settling" | "done";

const PREP_LABEL: Record<string, string> = {
  fund: "Preparing a one-time payout account…",
  open: "Opening Transak…",
};

export function TransakOffRampContent({
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
  const [settled, setSettled] = useState<TransakOrder | null>(null);

  const options = useMemo(() => claimableNotes(notes), [notes]);
  const selected = options.find((n) => n.leafIndex === selectedLeaf) ?? null;

  useEffect(() => {
    onBusyChange?.(step !== "select");
  }, [step, onBusyChange]);

  useEffect(() => {
    if (options.length === 0) {
      setSelectedLeaf(null);
      return;
    }
    if (options.some((n) => n.leafIndex === selectedLeaf)) return;
    setSelectedLeaf(options[0].leafIndex);
  }, [options, selectedLeaf]);

  async function start() {
    if (!selected) {
      setError("Select a payment to cash out.");
      return;
    }
    setError(null);
    setStep("preparing");

    const bridge: Bridge = createBridge();
    let session: TransakSession | null = null;
    let released = false;
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const amount = fromBaseUnits(selected.amount);

      setPrepPhase("fund");
      await provisionBridge(bridge);

      setPrepPhase("open");
      session = await openTransakOffRamp({
        walletAddress: bridge.publicKey,
        cryptoAmount: amount,
      });
      setStep("interactive");

      const ready = await pollTransakOrderUntil(
        session,
        hasDepositInstructions,
      );
      if (!ready.cryptoAddress) {
        throw new Error("Transak did not return a deposit address.");
      }

      setStep("settling");
      const scan = await scanMyNotes(acct);
      const note = scan.notes.find(
        (n) => n.leafIndex === selected.leafIndex && !n.spent,
      );
      if (!note) throw new Error("That payment is no longer available.");
      const ref = ready.id ?? bridge.publicKey;
      persistBridge(bridge, ref, note.amount);
      await releaseNoteToBridge({
        signer: getSigner(),
        acct,
        scan,
        note,
        bridge,
      });
      released = true;
      await sendUsdcPayment(bridge.keypair, {
        destination: ready.cryptoAddress,
        amount: fromBaseUnits(note.amount),
        memo: transakMemo(ready),
      });

      const final = await pollTransakOrderUntil(session, isCompleted);
      clearPersistedBridge(ref);
      session.close();
      setSettled(final);
      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Off-ramp failed.";
      session?.close();
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
        toastId="transak-empty"
      />
    );
  }

  if (step === "select") {
    return (
      <div className="grid gap-4">
        <div
          className={`${glassInsetClass} flex items-start gap-2 px-3 py-2.5 text-xs text-white/70`}
        >
          <Building2 className="mt-0.5 size-4 shrink-0 text-white/70" />
          <span>
            Cash out to your bank or e-wallet through{" "}
            <b className="font-semibold text-white">Transak</b>. Identity and
            payout details are verified by Transak — they never touch Olio.
          </span>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-white">
            Payment to cash out
          </legend>
          <div className="grid gap-2">
            {options.map((note) => {
              const active = note.leafIndex === selectedLeaf;
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
                  <span className="font-mono text-sm font-semibold text-white tabular-nums">
                    {fromBaseUnits(note.amount)} USDC
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

        <ToastFeedback
          title="Withdrawal not completed"
          message={error}
          variant="error"
          toastId="transak-withdrawal-error"
        />

        <Button variant="glass" className="min-h-11" size="lg" onClick={start}>
          <Building2 className="size-4" aria-hidden="true" />
          Continue to Transak
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
          A one-time payout account is prepared before any funds move. This can
          take a few seconds.
        </div>
      </div>
    );
  }

  if (step === "interactive") {
    return (
      <div className="grid gap-4">
        <div className={`${glassInsetClass} p-4 text-sm`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-white/60">Cashing out</span>
            <span className="font-heading text-2xl font-semibold text-white">
              {selected ? fromBaseUnits(selected.amount) : ""} USDC
            </span>
          </div>
        </div>
        <p className="text-sm text-white/65">
          Finish in the secure Transak window: verify your identity and enter
          where the cash should land. This screen updates automatically once
          Transak is ready.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-white/60">
          <Loader
            className="size-3.5 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Waiting for Transak…
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
            Sending your payout to Transak…
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
            {settled?.cryptoAmount
              ? `${settled.cryptoAmount} USDC on its way to your bank via Transak.`
              : "Your withdrawal is being processed by Transak."}{" "}
            Track it in the Transak window.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
