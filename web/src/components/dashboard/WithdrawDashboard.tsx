"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  CircleDollarSign,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { offRampEnabled } from "../../lib/anchor";
import { fromBaseUnits } from "../../lib/crypto";
import { getAccount, scanMyNotes } from "../../lib/notes";
import {
  type BatchWithdrawResult,
  claimableNotes,
  isValidDestination,
  type WithdrawResult,
  withdrawAll,
  withdrawNote,
} from "../../lib/withdraw";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useWallet } from "../WalletProvider";
import { DashboardShell } from "./DashboardShell";
import { OffRampContent } from "./OffRampContent";
import { useMyNotes } from "./useMyNotes";

type Step = "form" | "review" | "proving" | "done";
type Exit = "wallet" | "bank";

const withdrawFormSchema = z.object({
  destination: z
    .string()
    .trim()
    .refine(
      isValidDestination,
      "Enter a valid Stellar address that starts with G or C.",
    ),
});

type WithdrawFormInput = z.infer<typeof withdrawFormSchema>;

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-6)}`
    : address;
}

function formatUsd(units: bigint): string {
  return Number(fromBaseUnits(units)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function WithdrawDashboard() {
  const { address, accountUnlocked, promptUnlock, getSigner } = useWallet();
  const {
    notes,
    claimable,
    loading,
    error: notesError,
    refresh,
  } = useMyNotes(accountUnlocked ? address : undefined);
  const [step, setStep] = useState<Step>("form");
  const [exit, setExit] = useState<Exit>("wallet");
  const [bankBusy, setBankBusy] = useState(false);
  const [selectedLeaf, setSelectedLeaf] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState<"one" | "all">("one");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchWithdrawResult | null>(
    null,
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<WithdrawFormInput>({
    resolver: zodResolver(withdrawFormSchema),
    defaultValues: { destination: "" },
  });

  const options = useMemo(() => claimableNotes(notes), [notes]);
  const selected =
    options.find((note) => note.leafIndex === selectedLeaf) ?? null;
  const destination = watch("destination");

  useEffect(() => {
    if (options.length === 0) setSelectedLeaf(null);
    else if (!options.some((note) => note.leafIndex === selectedLeaf)) {
      setSelectedLeaf(options[0].leafIndex);
    }
  }, [options, selectedLeaf]);

  const review = handleSubmit(() => {
    setSubmitError(null);
    if (selectMode === "one" && !selected) {
      setSubmitError("Select a payment to cash out.");
      return;
    }
    setStep("review");
  });

  async function confirm() {
    setSubmitError(null);
    setStep("proving");
    try {
      const account = getAccount();
      if (!account) throw new Error("Unlock your private account to continue.");
      const scan = await scanMyNotes(account);

      if (selectMode === "all") {
        const batch = await withdrawAll({
          signer: getSigner(),
          acct: account,
          scan,
          notes: scan.notes,
          destination: destination.trim(),
        });
        if (batch.succeeded.length === 0) {
          throw new Error(
            batch.failed[0]?.error ?? "No payments were available to cash out.",
          );
        }
        setBatchResult(batch);
        setResult(null);
        setStep("done");
        refresh();
        return;
      }

      if (!selected) throw new Error("Select a payment to cash out.");
      const note = scan.notes.find(
        (candidate) =>
          candidate.leafIndex === selected.leafIndex && !candidate.spent,
      );
      if (!note) throw new Error("That payment is no longer available.");
      const withdrawal = await withdrawNote({
        signer: getSigner(),
        acct: account,
        scan,
        note,
        destination: destination.trim(),
      });
      setResult(withdrawal);
      setBatchResult(null);
      setStep("done");
      refresh();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Withdrawal failed. Try again.",
      );
      setStep("review");
    }
  }

  function startAnother() {
    setStep("form");
    setResult(null);
    setBatchResult(null);
    setSelectMode("one");
    setSubmitError(null);
    reset({ destination: "" });
  }

  return (
    <DashboardShell navigation showBack>
      <div className="mb-7">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Withdraw
        </h1>
        <p className="mt-2 max-w-2xl text-sm font-medium text-white/70 sm:text-base">
          Cash out private USDC to another Stellar wallet or, when available,
          directly to your bank.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)] lg:gap-6">
        <Card appearance="glass" className="gap-0 p-0">
          <div className="border-b border-white/12 p-4 sm:p-5">
            <fieldset className="grid grid-cols-2 gap-1 rounded-lg bg-white/7 p-1 ring-1 ring-white/12 backdrop-blur-md">
              <legend className="sr-only">Cash-out destination</legend>
              {(
                [
                  { key: "wallet", label: "Stellar wallet", icon: Wallet },
                  { key: "bank", label: "Bank account", icon: Banknote },
                ] as const
              ).map(({ key, label, icon: Icon }) => {
                const active = exit === key;
                const disabled = key === "bank" && !offRampEnabled;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    disabled={disabled || bankBusy}
                    onClick={() => {
                      setExit(key);
                      setSubmitError(null);
                    }}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "bg-white/18 text-white ring-1 ring-white/25"
                        : "text-white/65 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </fieldset>
            {!offRampEnabled ? (
              <p className="mt-2 text-xs text-white/55">
                Bank cash-out is unavailable in this environment.
              </p>
            ) : null}
          </div>

          <div className="p-4 sm:p-6">
            {!accountUnlocked ? (
              <LockedState onUnlock={promptUnlock} />
            ) : loading ? (
              <LoadingState />
            ) : notesError ? (
              <ErrorState message={notesError} onRetry={refresh} />
            ) : options.length === 0 ? (
              <EmptyState />
            ) : exit === "bank" ? (
              <div>
                <OffRampContent notes={notes} onBusyChange={setBankBusy} />
              </div>
            ) : (
              <div>
                <WalletWithdrawal
                  step={step}
                  options={options}
                  selectedLeaf={selectedLeaf}
                  selectedAmount={selected?.amount ?? null}
                  selectMode={selectMode}
                  claimableTotal={claimable}
                  destination={destination}
                  result={result}
                  batchResult={batchResult}
                  submitError={submitError}
                  fieldError={errors.destination?.message}
                  registerDestination={register("destination")}
                  onSelectOne={(leaf) => {
                    setSelectedLeaf(leaf);
                    setSelectMode("one");
                  }}
                  onSelectAll={() => setSelectMode("all")}
                  onReview={review}
                  onBack={() => setStep("form")}
                  onConfirm={confirm}
                  onDone={startAnother}
                />
              </div>
            )}
          </div>
        </Card>

        <aside
          className="grid gap-4 lg:sticky lg:top-6"
          aria-label="Cash-out details"
        >
          <Card appearance="glass" className="gap-4 p-5">
            {/* <div className="flex size-11 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
              <CircleDollarSign className="size-5" aria-hidden="true" />
            </div> */}
            <div>
              <p className="text-sm font-medium text-white/60">Available</p>
              <p className="mt-1 font-mono text-4xl font-semibold tracking-tight text-white tabular-nums">
                {accountUnlocked && !loading ? formatUsd(claimable) : "—"}
              </p>
              <p className="mt-1 text-sm text-white/55">
                {accountUnlocked && !loading
                  ? `${options.length} private payment${options.length === 1 ? "" : "s"}`
                  : "Private USDC"}
              </p>
            </div>
          </Card>

          <Card appearance="glass" className="gap-4 p-5">
            {/* <div className="flex size-11 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div> */}
            <div className="space-y-2">
              <h2 className="font-heading text-3xl font-semibold text-white">
                Private by design
              </h2>
              <p className="text-sm leading-6 text-white/65">
                A zero-knowledge proof releases the selected payment without
                revealing which deposit funded it.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </DashboardShell>
  );
}

type WalletWithdrawalProps = {
  step: Step;
  options: ReturnType<typeof claimableNotes>;
  selectedLeaf: number | null;
  selectedAmount: bigint | null;
  selectMode: "one" | "all";
  claimableTotal: bigint;
  destination: string;
  result: WithdrawResult | null;
  batchResult: BatchWithdrawResult | null;
  submitError: string | null;
  fieldError?: string;
  registerDestination: ReturnType<
    ReturnType<typeof useForm<WithdrawFormInput>>["register"]
  >;
  onSelectOne: (leaf: number) => void;
  onSelectAll: () => void;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onDone: () => void;
};

function WalletWithdrawal({
  step,
  options,
  selectedLeaf,
  selectedAmount,
  selectMode,
  claimableTotal,
  destination,
  result,
  batchResult,
  submitError,
  fieldError,
  registerDestination,
  onSelectOne,
  onSelectAll,
  onReview,
  onBack,
  onConfirm,
  onDone,
}: WalletWithdrawalProps) {
  if (options.length === 0 && step === "form") {
    return (
      <div className="grid place-items-center gap-4 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
          <Banknote className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-white">
            No payments to cash out
          </h2>
          <p className="max-w-sm text-sm text-white/65">
            Share a payment link first. Private payments you receive will appear
            here.
          </p>
        </div>
        <Button
          variant="glass"
          nativeButton={false}
          render={<Link href="/dashboard/links" />}
        >
          View payment links
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (step === "form") {
    return (
      <form className="grid gap-5" onSubmit={onReview} noValidate>
        <div className="grid gap-2">
          <Label className="text-white" htmlFor="withdraw-destination">
            Destination wallet
          </Label>
          <Input
            {...registerDestination}
            appearance="glass"
            id="withdraw-destination"
            className="min-h-11 font-mono text-sm"
            placeholder="G… or C…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={fieldError ? "true" : undefined}
            aria-describedby={
              fieldError
                ? "withdraw-destination-error"
                : "withdraw-destination-hint"
            }
          />
          {fieldError ? (
            <p id="withdraw-destination-error" className="text-sm text-red-200">
              {fieldError}
            </p>
          ) : (
            <p id="withdraw-destination-hint" className="text-xs text-white/60">
              Enter the external Stellar address that should receive the funds.
            </p>
          )}
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-white">
            Payment to cash out
          </legend>
          <div className="grid gap-2">
            {options.length > 1 ? (
              <button
                type="button"
                onClick={onSelectAll}
                aria-pressed={selectMode === "all"}
                className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left ring-1 ring-inset transition-colors focus-visible:ring-2 focus-visible:ring-white/70 ${
                  selectMode === "all"
                    ? "border-white/45 bg-white/16 ring-white/25"
                    : "border-white/20 bg-gradient-to-r from-white/[0.13] to-white/[0.06] ring-white/10 hover:border-white/30 hover:from-white/[0.17]"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span
                    className={`grid size-5 place-items-center rounded-full border ${
                      selectMode === "all"
                        ? "border-white bg-white text-ink"
                        : "border-white/35"
                    }`}
                    aria-hidden="true"
                  >
                    {selectMode === "all" ? <Check className="size-3" /> : null}
                  </span>
                  All payments
                  <span className="rounded-full bg-white/12 px-2 py-0.5 text-xs font-medium text-white/75">
                    {options.length}
                  </span>
                </span>
                <span className="font-mono text-sm font-semibold text-white tabular-nums">
                  {fromBaseUnits(claimableTotal)} USDC
                </span>
              </button>
            ) : null}
            {options.map((note) => {
              const active =
                selectMode === "one" && note.leafIndex === selectedLeaf;
              return (
                <button
                  key={note.leafIndex}
                  type="button"
                  onClick={() => onSelectOne(note.leafIndex)}
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
                      {active ? <Check className="size-3" /> : null}
                    </span>
                    Payment #{note.leafIndex}
                  </span>
                  <span className="font-mono text-sm font-semibold text-white tabular-nums">
                    {fromBaseUnits(note.amount)} USDC
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-white/60">
            Private payments are cashed out in full. Cash out one, or all of
            them to the same address.
          </p>
        </fieldset>

        {submitError ? <InlineError message={submitError} /> : null}

        <Button
          type="submit"
          variant="glass"
          size="lg"
          className="w-full sm:w-fit sm:min-w-40 mt-4"
        >
          Review withdrawal
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
    );
  }

  if (step === "review" && (selectMode === "all" || selectedAmount !== null)) {
    const reviewAmount = selectMode === "all" ? claimableTotal : selectedAmount;
    return (
      <div className="grid gap-5">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-10 w-fit items-center gap-2 rounded-lg px-2 text-sm font-semibold text-white/70 hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Edit details
        </button>
        <div className="rounded-lg bg-white/8 p-4 ring-1 ring-white/15">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-white/60">Cashing out</span>
            <span className="font-heading text-2xl font-semibold text-white">
              {fromBaseUnits(reviewAmount ?? 0n)} USDC
            </span>
          </div>
          {selectMode === "all" ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/12 pt-4">
              <span className="text-sm text-white/60">Payments</span>
              <span className="text-sm font-medium text-white">
                {options.length} released as {options.length} separate proofs
              </span>
            </div>
          ) : null}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/12 pt-4">
            <span className="text-sm text-white/60">To</span>
            <span className="font-mono text-sm font-medium text-white">
              {shortAddress(destination.trim())}
            </span>
          </div>
        </div>
        {submitError ? <InlineError message={submitError} /> : null}
        <Button
          variant="glass"
          size="lg"
          className="w-full sm:w-fit sm:min-w-44 mt-4"
          onClick={onConfirm}
        >
          Confirm &amp; cash out
        </Button>
      </div>
    );
  }

  if (step === "proving") {
    return (
      <div
        className="grid place-items-center gap-3 py-12 text-center"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="size-8 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div className="text-sm font-semibold text-white">
          Generating proof and releasing funds…
        </div>
        <div className="max-w-sm text-sm text-white/65">
          The zero-knowledge proof is built in your browser. This can take a few
          seconds.
        </div>
      </div>
    );
  }

  if (step === "done" && batchResult) {
    const count = batchResult.succeeded.length;
    const failedCount = batchResult.failed.length;
    return (
      <div className="grid place-items-center gap-4 py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-ok/20 text-emerald-100 ring-1 ring-ok/40">
          <Check className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-semibold text-white">
            Cashed out {fromBaseUnits(batchResult.total)} USDC
          </h2>
          <p className="max-w-md text-sm text-white/65">
            {count} payment{count === 1 ? "" : "s"}{" "}
            {batchResult.mode === "claimable"
              ? `waiting for ${shortAddress(destination.trim())} to claim in a Stellar wallet.`
              : `sent to ${shortAddress(destination.trim())}.`}
          </p>
        </div>
        {failedCount > 0 ? (
          <Alert appearance="glass" variant="destructive" className="text-left">
            <AlertTitle>
              {failedCount} payment{failedCount === 1 ? "" : "s"} couldn&apos;t
              be cashed out
            </AlertTitle>
            <AlertDescription>
              {`They're still in your balance — try again. `}
              {batchResult.failed[0]?.error}
            </AlertDescription>
          </Alert>
        ) : null}
        <Button variant="glass" size="lg" onClick={onDone} className="mt-4">
          Cash out more
        </Button>
      </div>
    );
  }

  if (step === "done" && result && selectedAmount !== null) {
    return (
      <div className="grid place-items-center gap-4 py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-ok/20 text-emerald-100 ring-1 ring-ok/40">
          <Check className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-semibold text-white">
            Cashed out {fromBaseUnits(selectedAmount)} USDC
          </h2>
          <p className="max-w-md text-sm text-white/65">
            {result.mode === "claimable"
              ? `The funds are waiting for ${shortAddress(destination.trim())} to claim them in a Stellar wallet.`
              : `The funds were sent to ${shortAddress(destination.trim())}.`}{" "}
            The proof took {(result.provingMs / 1000).toFixed(1)}s.
          </p>
        </div>
        <Button variant="glass" size="lg" onClick={onDone} className="mt-4">
          Cash out another payment
        </Button>
      </div>
    );
  }

  return null;
}

function LockedState({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="grid place-items-center gap-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
        <LockKeyhole className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-white">
          Unlock to cash out
        </h2>
        <p className="max-w-sm text-sm text-white/65">
          Your PIN unlocks the private notes stored on this device.
        </p>
      </div>
      <Button variant="glass" size="lg" onClick={onUnlock}>
        Unlock with PIN
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center gap-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
        <Banknote className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-white">
          No payments to cash out
        </h2>
        <p className="max-w-sm text-sm text-white/65">
          Share a payment link first. Private payments you receive will appear
          here.
        </p>
      </div>
      <Button
        variant="glass"
        nativeButton={false}
        render={<Link href="/dashboard/links" />}
      >
        View payment links
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="grid gap-5 motion-safe:animate-pulse"
      role="status"
      aria-label="Loading private payments"
    >
      <div className="space-y-2">
        <div className="h-4 w-36 rounded-full bg-white/10" />
        <div className="h-11 rounded-lg bg-white/8" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-44 rounded-full bg-white/10" />
        <div className="h-14 rounded-lg bg-white/8" />
        <div className="h-14 rounded-lg bg-white/8" />
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert appearance="glass" variant="destructive">
      <AlertTitle>Could not load private payments</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        <Button type="button" variant="glass" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <Alert appearance="glass" variant="destructive">
      <AlertTitle>Withdrawal not completed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
