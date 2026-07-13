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
  pollSep24Until,
  type Sep24Transaction,
  sendWithdrawalPayment,
  startInteractiveWithdraw,
} from "../../lib/anchor";
import { fromBaseUnits } from "../../lib/crypto";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import {
  type Bridge,
  createBridge,
  provisionBridge,
  releaseNoteToBridge,
} from "../../lib/offramp";
import { claimableNotes } from "../../lib/withdraw";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
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

  const options = useMemo(() => claimableNotes(notes), [notes]);
  const selected = options.find((n) => n.leafIndex === selectedLeaf) ?? null;

  // The exit can't be switched once the pool release is under way (the note is
  // already spent), so let the parent lock the wallet/bank toggle.
  useEffect(() => {
    onBusyChange?.(step !== "select");
  }, [step, onBusyChange]);

  useEffect(() => {
    if (options.length === 0) setSelectedLeaf(null);
    else if (!options.some((n) => n.leafIndex === selectedLeaf))
      setSelectedLeaf(options[0].leafIndex);
  }, [options, selectedLeaf]);

  async function start() {
    if (!selected) {
      setError("Select a payment to cash out.");
      return;
    }
    setError(null);
    setStep("preparing");
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const scan = await scanMyNotes(acct);
      const note = scan.notes.find(
        (n) => n.leafIndex === selected.leafIndex && !n.spent,
      );
      if (!note) throw new Error("That payment is no longer available.");

      // 1 · one-time bridge account (XLM + trustline)
      setPrepPhase("fund");
      const bridge: Bridge = createBridge();
      await provisionBridge(bridge);

      // 2 · zk-withdraw the note into the bridge (this generates the proof)
      setPrepPhase("release");
      await releaseNoteToBridge({
        signer: getSigner(),
        acct,
        scan,
        note,
        bridge,
      });

      // 3 · SEP-10 auth as the bridge account
      setPrepPhase("auth");
      const info = await fetchAnchorInfo();
      const token = await authenticate(info, bridge.keypair);

      // 4 · open the interactive SEP-24 withdrawal
      setPrepPhase("init");
      const { id, url } = await startInteractiveWithdraw(
        info,
        token,
        bridge.publicKey,
        fromBaseUnits(note.amount),
      );
      setInteractive({ info, token, id, url });
      setStep("interactive");

      // 5 · wait for the user to finish KYC/bank details in the anchor window,
      // then settle the on-chain leg from the bridge.
      const ready = await pollSep24Until(
        info,
        token,
        id,
        (tx) =>
          tx.status === "pending_user_transfer_start" ||
          tx.status === "completed",
      );
      if (ready.status !== "completed") {
        setStep("settling");
        await sendWithdrawalPayment(bridge.keypair, ready);
      }
      const final = await pollSep24Until(
        info,
        token,
        id,
        (tx) => tx.status === "completed",
      );
      setSettled(final);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Off-ramp failed.");
      setStep("select");
    }
  }

  if (options.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No payments to cash out yet. Share your pay link to receive your first
          private payment.
        </AlertDescription>
      </Alert>
    );
  }

  if (step === "select") {
    return (
      <div className="grid gap-4">
        <div className="flex items-start gap-2 rounded-lg bg-sage/50 px-3 py-2.5 text-xs text-olive-deep">
          <Landmark className="mt-0.5 size-4 shrink-0 text-olive" />
          <span>
            Cash out to your bank through <b>{anchorLabel()}</b>. Identity and
            bank details are handled by the anchor — they never touch Olio.
          </span>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm text-ink">Payment to cash out</legend>
          <div className="grid gap-2">
            {options.map((note) => {
              const active = note.leafIndex === selectedLeaf;
              return (
                <button
                  key={note.leafIndex}
                  type="button"
                  onClick={() => setSelectedLeaf(note.leafIndex)}
                  aria-pressed={active}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-olive/50 bg-sage/50"
                      : "border-line bg-white/60 hover:border-olive/30 hover:bg-sage/30"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm text-ink">
                    <span
                      className={`grid size-4 place-items-center rounded-full border ${
                        active
                          ? "border-olive bg-olive text-paper"
                          : "border-line"
                      }`}
                    >
                      {active && <Check className="size-3" />}
                    </span>
                    Payment #{note.leafIndex}
                  </span>
                  <span className="font-mono text-sm font-semibold text-ink">
                    {fromBaseUnits(note.amount)} USDC
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-text">
            Each payment is cashed out in full. To move a smaller amount,
            receive it as a separate payment.
          </p>
        </fieldset>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button className="min-h-11" size="lg" onClick={start}>
          <Banknote className="size-4" />
          Continue to bank
        </Button>
      </div>
    );
  }

  if (step === "preparing") {
    return (
      <div className="grid place-items-center gap-3 py-8 text-center">
        <Loader2 className="size-8 animate-spin text-olive" />
        <div className="text-sm font-medium text-ink">
          {PREP_LABEL[prepPhase] ?? "Preparing…"}
        </div>
        <div className="text-xs text-muted-text">
          A zero-knowledge proof is generated in your browser before any funds
          move. This can take a few seconds.
        </div>
      </div>
    );
  }

  if (step === "interactive" && interactive) {
    return (
      <div className="grid gap-4">
        <div className="rounded-lg border border-line bg-white/60 p-4 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-text">Cashing out</span>
            <span className="font-heading text-2xl font-semibold text-ink">
              {selected ? fromBaseUnits(selected.amount) : ""} USDC
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-text">
          Finish in the secure {anchorLabel()} window: verify your identity and
          enter where the cash should land. This screen updates automatically
          once you're done.
        </p>
        <Button
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
          <ExternalLink className="size-4" />
          Open secure {anchorLabel()} window
        </Button>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-text">
          <Loader2 className="size-3.5 animate-spin" />
          Waiting for the anchor…
        </div>
      </div>
    );
  }

  if (step === "settling") {
    return (
      <div className="grid place-items-center gap-3 py-8 text-center">
        <Loader2 className="size-8 animate-spin text-olive" />
        <div className="text-sm font-medium text-ink">
          Sending your payout to the anchor…
        </div>
        <div className="text-xs text-muted-text">
          Completing the on-chain transfer. Hang tight.
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="grid place-items-center gap-3 py-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-ok/15 text-ok">
          <ShieldCheck className="size-6" />
        </div>
        <div className="font-heading text-lg font-semibold text-ink">
          Cash-out submitted
        </div>
        <div className="max-w-xs text-xs text-muted-text">
          {settled?.amount_out
            ? `${settled.amount_out} on its way to your bank via ${anchorLabel()}.`
            : `Your withdrawal is being processed by ${anchorLabel()}.`}{" "}
          Track it in the anchor window.
        </div>
      </div>
    );
  }

  return null;
}
