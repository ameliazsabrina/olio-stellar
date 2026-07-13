"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Check, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { fromBaseUnits } from "../../lib/crypto";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import {
  claimableNotes,
  isValidDestination,
  type WithdrawResult,
  withdrawNote,
} from "../../lib/withdraw";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { useWallet } from "../WalletProvider";

type Step = "form" | "review" | "proving" | "done";

const withdrawFormSchema = z.object({
  destination: z.string().trim(),
});

type WithdrawFormInput = z.infer<typeof withdrawFormSchema>;

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-6)}`
    : address;
}

export function WithdrawDialog({
  open,
  onClose,
  notes,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  notes: MyNote[];
  onSuccess: () => void;
}) {
  const { getSigner } = useWallet();
  const [step, setStep] = useState<Step>("form");
  const [selectedLeaf, setSelectedLeaf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const {
    register,
    handleSubmit,
    reset: resetForm,
    watch,
    formState: { errors },
  } = useForm<WithdrawFormInput>({
    resolver: zodResolver(withdrawFormSchema),
    defaultValues: { destination: "" },
  });

  const options = useMemo(() => claimableNotes(notes), [notes]);
  const destination = watch("destination");

  // Default to the largest available payment whenever the note set changes.
  useEffect(() => {
    if (options.length === 0) {
      setSelectedLeaf(null);
    } else if (!options.some((n) => n.leafIndex === selectedLeaf)) {
      setSelectedLeaf(options[0].leafIndex);
    }
  }, [options, selectedLeaf]);

  const selected = options.find((n) => n.leafIndex === selectedLeaf) ?? null;

  function reset() {
    setStep("form");
    setSelectedLeaf(null);
    setError(null);
    setResult(null);
    resetForm({ destination: "" });
  }

  function handleClose() {
    reset();
    onClose();
  }

  const review = handleSubmit((values) => {
    setError(null);
    if (!isValidDestination(values.destination)) {
      setError("Enter a valid Stellar address (starts with G or C).");
      return;
    }
    if (!selected) {
      setError("Select a payment to cash out.");
      return;
    }
    setStep("review");
  });

  async function confirm() {
    if (!selected) return;
    setError(null);
    setStep("proving");
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const scan = await scanMyNotes(acct);
      const note = scan.notes.find(
        (n) => n.leafIndex === selected.leafIndex && !n.spent,
      );
      if (!note) throw new Error("That payment is no longer available.");
      const res = await withdrawNote({
        signer: getSigner(),
        acct,
        scan,
        note,
        destination: destination.trim(),
      });
      setResult(res);
      setStep("done");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdrawal failed.");
      setStep("review");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="flex items-center gap-2">
          {step === "review" && (
            <button
              type="button"
              onClick={() => setStep("form")}
              className="text-muted-text hover:text-ink"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          Cash out
        </DialogTitle>

        {step === "form" && (
          <div className="grid gap-4">
            {options.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No payments to cash out yet. Share your pay link to receive
                  your first private payment.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="grid gap-2">
                  <label
                    htmlFor="withdraw-destination"
                    className="text-sm text-ink"
                  >
                    Destination wallet
                  </label>
                  <Input
                    id="withdraw-destination"
                    className="min-h-11 font-mono text-sm"
                    placeholder="G… or C…"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    {...register("destination")}
                  />
                  <p className="text-xs text-muted-text">
                    Funds leave the shielded pool to this external Stellar
                    address.
                  </p>
                </div>

                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm text-ink">
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
                    Each payment is cashed out in full. To move a smaller
                    amount, receive it as a separate payment.
                  </p>
                </fieldset>

                {(error || errors.destination) && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {error ?? errors.destination?.message}
                    </AlertDescription>
                  </Alert>
                )}

                <Button className="min-h-11" size="lg" onClick={() => review()}>
                  Review
                </Button>
              </>
            )}
          </div>
        )}

        {step === "review" && selected && (
          <div className="grid gap-4">
            <div className="rounded-lg border border-line bg-white/60 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-text">Cashing out</span>
                <span className="font-heading text-2xl font-semibold text-ink">
                  {fromBaseUnits(selected.amount)} USDC
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-sm text-muted-text">To</span>
                <span className="font-mono text-sm font-medium text-ink">
                  {shortAddress(destination.trim())}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-sage/50 px-3 py-2.5 text-xs text-olive-deep">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-olive" />
              <span>
                A zero-knowledge proof authorizes the release without linking
                this payout to the payment that funded it.
              </span>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button className="min-h-11" size="lg" onClick={confirm}>
              Confirm &amp; cash out
            </Button>
          </div>
        )}

        {step === "proving" && (
          <div className="grid place-items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-olive" />
            <div className="text-sm font-medium text-ink">
              Generating proof &amp; releasing funds…
            </div>
            <div className="text-xs text-muted-text">
              Building a zero-knowledge proof in your browser. This can take a
              few seconds.
            </div>
          </div>
        )}

        {step === "done" && result && selected && (
          <div className="grid place-items-center gap-3 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-ok/15 text-ok">
              <Wallet className="size-6" />
            </div>
            <div className="font-heading text-lg font-semibold text-ink">
              Cashed out {fromBaseUnits(selected.amount)} USDC
            </div>
            <div className="text-xs text-muted-text">
              Sent to {shortAddress(destination.trim())} · proof took{" "}
              {(result.provingMs / 1000).toFixed(1)}s
            </div>
            <Button className="mt-2 min-h-11" size="lg" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
