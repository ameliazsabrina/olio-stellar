"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Landmark,
  Loader,
  LockKeyhole,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { offRampEnabled } from "../../lib/anchor";
import { LINKS_PATH } from "../../lib/auth-routes";
import { fromBaseUnits } from "../../lib/crypto";
import {
  moneyGramCashInEnabled,
  moneyGramCashOutStatusEnabled,
  moneyGramRampStatus,
} from "../../lib/moneygram-status";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import {
  claimableNotes,
  isAlreadyCashedOut,
  isValidDestination,
  withdrawAll,
  withdrawNote,
} from "../../lib/withdraw";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { glassInsetClass } from "../ui/glass";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { OffRampContent } from "./OffRampContent";
import { StrandedFundsRecovery } from "./StrandedFundsRecovery";
import { useMyNotes } from "./useMyNotes";

const MoneyGramActivity = lazy(() =>
  import("./MoneyGramActivity").then((module) => ({
    default: module.MoneyGramActivity,
  })),
);

type WalletStep = "form" | "review" | "proving";
type DialogView = "method" | "wallet" | "anchor";
type WithdrawalTarget =
  | { kind: "one"; note: MyNote }
  | { kind: "all"; notes: MyNote[] };

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

function formatWithdrawalUsd(units: bigint): string {
  return Number(fromBaseUnits(units)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function targetTotal(target: WithdrawalTarget | null): bigint {
  if (!target) return 0n;
  if (target.kind === "one") return target.note.amount;
  return target.notes.reduce((total, note) => total + note.amount, 0n);
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
  const [target, setTarget] = useState<WithdrawalTarget | null>(null);
  const [dialogView, setDialogView] = useState<DialogView>("method");
  const [walletStep, setWalletStep] = useState<WalletStep>("form");
  const [bankBusy, setBankBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const withdrawalRunIdRef = useRef(0);
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
  const destination = watch("destination");
  const dialogBusy = bankBusy || walletStep === "proving";
  const selectedNote = target?.kind === "one" ? target.note : null;
  const selectedTotal = targetTotal(target);
  const recoveryJoinsPaymentGrid =
    accountUnlocked && !loading && !notesError && options.length > 0;
  const showMethodBack =
    !dialogBusy &&
    (dialogView === "anchor" ||
      (dialogView === "wallet" && walletStep === "form"));

  function openWithdrawal(nextTarget: WithdrawalTarget) {
    withdrawalRunIdRef.current += 1;
    setTarget(nextTarget);
    setDialogView("method");
    setWalletStep("form");
    setBankBusy(false);
    setSubmitError(null);
    reset({ destination: "" });
  }

  function closeWithdrawal() {
    if (bankBusy) return;
    withdrawalRunIdRef.current += 1;
    setTarget(null);
    setDialogView("method");
    setWalletStep("form");
    setSubmitError(null);
    reset({ destination: "" });
  }

  function returnToMethods() {
    setSubmitError(null);
    setWalletStep("form");
    setDialogView("method");
  }

  const review = handleSubmit(() => {
    setSubmitError(null);
    if (!target) {
      setSubmitError("Select a payment to cash out.");
      return;
    }
    setWalletStep("review");
  });

  async function confirm() {
    if (!target) return;
    const runId = withdrawalRunIdRef.current + 1;
    withdrawalRunIdRef.current = runId;
    const isCurrentRun = () => withdrawalRunIdRef.current === runId;

    setSubmitError(null);
    setWalletStep("proving");
    try {
      const account = getAccount();
      if (!account) throw new Error("Unlock your private account to continue.");
      const scan = await scanMyNotes(account);

      if (target.kind === "all") {
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
        const count = batch.succeeded.length;
        toast.success(`Cashed out ${fromBaseUnits(batch.total)} USDC`, {
          description:
            batch.mode === "claimable"
              ? `${count} payment${count === 1 ? "" : "s"} waiting for ${shortAddress(destination.trim())} to claim in a Stellar wallet.`
              : `${count} payment${count === 1 ? "" : "s"} sent to ${shortAddress(destination.trim())}.`,
          id: "wallet-withdrawal-success",
        });
        if (batch.failed.length > 0) {
          const failedCount = batch.failed.length;
          toast.error(
            `${failedCount} payment${failedCount === 1 ? "" : "s"} couldn't be cashed out`,
            {
              description:
                `They're still in your balance — try again. ${batch.failed[0]?.error ?? ""}`.trim(),
              id: "wallet-withdrawal-partial-error",
            },
          );
        }
        await refresh();
        if (isCurrentRun()) {
          setBankBusy(false);
          setWalletStep("form");
          setTarget(null);
        }
        return;
      }

      const note = scan.notes.find(
        (candidate) =>
          candidate.leafIndex === target.note.leafIndex && !candidate.spent,
      );
      if (!note) throw new Error("That payment is no longer available.");
      const withdrawal = await withdrawNote({
        signer: getSigner(),
        acct: account,
        scan,
        note,
        destination: destination.trim(),
      });
      toast.success(`Cashed out ${fromBaseUnits(target.note.amount)} USDC`, {
        description:
          withdrawal.mode === "claimable"
            ? `The funds are waiting for ${shortAddress(destination.trim())} to claim them in a Stellar wallet.`
            : `The funds were sent to ${shortAddress(destination.trim())}.`,
        id: "wallet-withdrawal-success",
      });
      await refresh();
      if (isCurrentRun()) {
        setBankBusy(false);
        setWalletStep("form");
        setTarget(null);
      }
    } catch (error) {
      const alreadyCashedOut = isAlreadyCashedOut(error);
      const message = alreadyCashedOut
        ? "This payment was already cashed out."
        : error instanceof Error
          ? error.message
          : "Withdrawal failed. Try again.";

      if (alreadyCashedOut) {
        refresh();
      }

      if (isCurrentRun()) {
        setSubmitError(message);
        setWalletStep("review");
      } else {
        toast.error("Withdrawal failed", {
          description: message,
          id: "wallet-withdrawal-background-error",
        });
      }
    }
  }

  return (
    <>
      <DashboardPageHeader
        title="Withdraw"
        description={
          <>
            Choose a private payment, then send it to a Stellar wallet or cash
            it out through an available anchor.
          </>
        }
      />

      {!recoveryJoinsPaymentGrid ? (
        <StrandedFundsRecovery defaultDestination={address} />
      ) : null}

      {!accountUnlocked ? (
        <LockedState onUnlock={promptUnlock} />
      ) : loading ? (
        <LoadingState />
      ) : notesError ? (
        <ErrorState message={notesError} onRetry={refresh} />
      ) : options.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="grid gap-4" aria-labelledby="payments-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="payments-title"
                className="font-heading text-xl font-semibold text-brand-linen"
              >
                Private payments
              </h2>
              <p className="mt-1 text-sm text-brand-linen/60">
                Payments are withdrawn in full without revealing the deposit
                that funded them.
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-lg font-semibold text-brand-linen tabular-nums">
                {formatUsd(claimable)}
              </p>
              <p className="text-xs text-brand-linen/65">
                {options.length} available
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StrandedFundsRecovery
              defaultDestination={address}
              className="mb-0"
            />
            {options.length > 1 ? (
              <AllPaymentsCard
                notes={options}
                total={claimable}
                onClick={() =>
                  openWithdrawal({ kind: "all", notes: [...options] })
                }
              />
            ) : null}
            {options.map((note, index) => (
              <PaymentCard
                key={note.leafIndex}
                note={note}
                index={index}
                onClick={() => openWithdrawal({ kind: "one", note })}
              />
            ))}
          </div>
        </section>
      )}

      {moneyGramCashInEnabled ? (
        <Suspense fallback={null}>
          <MoneyGramActivity />
        </Suspense>
      ) : null}

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) closeWithdrawal();
        }}
      >
        <DialogContent
          appearance="glass"
          size="md"
          showCloseButton={false}
        >
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-start gap-3 border-b border-brand-linen/12 pb-5 sm:pb-6">
            <div className="size-10">
              {target && showMethodBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-brand-linen/60 hover:bg-brand-linen/10 hover:text-brand-linen"
                  onClick={returnToMethods}
                  aria-label="Back to withdrawal methods"
                  title="Back to withdrawal methods"
                >
                  <ArrowLeft className="size-5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            <div className="min-w-0 pt-1 text-center">
              <DialogTitle className="text-xl leading-7 text-brand-linen">
                {target?.kind === "all"
                  ? "Withdraw all payments"
                  : "Withdraw payment"}
              </DialogTitle>
              <DialogDescription className="mt-6">
                {target ? (
                  <>
                    <span className="block text-6xl font-medium tracking-tight text-brand-linen tabular-nums">
                      {formatWithdrawalUsd(selectedTotal)}
                    </span>
                    <span className="mt-4 block text-xs text-brand-linen/60">
                      {target.kind === "all"
                        ? `across ${target.notes.length} private payments`
                        : "from one private payment"}
                    </span>
                  </>
                ) : null}
              </DialogDescription>
            </div>

            <div className="size-10">
              {!bankBusy ? (
                <DialogClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-brand-linen/60 hover:bg-brand-linen/10 hover:text-brand-linen"
                    />
                  }
                >
                  <X className="size-5" aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </DialogClose>
              ) : null}
            </div>
          </div>

          <div>
            {target && dialogView === "method" ? (
              <WithdrawalMethodPicker
                bulk={target.kind === "all"}
                onWallet={() => setDialogView("wallet")}
                onAnchor={() => setDialogView("anchor")}
              />
            ) : null}

            {target && dialogView === "wallet" ? (
              <WalletWithdrawal
                step={walletStep}
                amount={selectedTotal}
                paymentCount={
                  target.kind === "all" ? target.notes.length : undefined
                }
                destination={destination}
                submitError={submitError}
                fieldError={errors.destination?.message}
                registerDestination={register("destination")}
                onReview={review}
                onBack={() => setWalletStep("form")}
                onConfirm={confirm}
              />
            ) : null}

            {target && dialogView === "anchor" && selectedNote ? (
              moneyGramCashOutStatusEnabled && offRampEnabled ? (
                <OffRampContent
                  note={selectedNote}
                  onBusyChange={setBankBusy}
                  onComplete={refresh}
                />
              ) : null
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaymentCard({
  note,
  index,
  onClick,
}: {
  note: MyNote;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group text-left focus-visible:outline-none"
      onClick={onClick}
      aria-label={`Withdraw private payment ${index + 1}, ${fromBaseUnits(note.amount)} USDC`}
    >
      <Card
        appearance="linen"
        density="comfortable"
        className="min-h-64 justify-between gap-5 transition-[box-shadow,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-0.5 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-linen"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Private payment
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              ${fromBaseUnits(note.amount)}
            </p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              USDC
            </p>
          </div>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-border">
            <Banknote className="size-5" aria-hidden="true" />
          </div>
        </div>

        <div>
          <div className="mb-4 h-px bg-border" />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Ready to withdraw
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Choose method
              <ArrowRight
                className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </Card>
    </button>
  );
}

function AllPaymentsCard({
  notes,
  total,
  onClick,
}: {
  notes: MyNote[];
  total: bigint;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group text-left focus-visible:outline-none"
      onClick={onClick}
      aria-label={`Withdraw all ${notes.length} payments, ${fromBaseUnits(total)} USDC total`}
    >
      <Card
        appearance="linen"
        density="comfortable"
        className="relative min-h-64 justify-between gap-4 transition-[box-shadow,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-0.5 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-linen"
      >
        <div className="relative z-10 max-w-[58%]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            All payments
          </p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            ${fromBaseUnits(total)}
          </p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            USDC · {notes.length} payments
          </p>
        </div>

        <AllPaymentsSketch />

        <div className="relative z-10 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Withdraw together
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
      </Card>
    </button>
  );
}

function AllPaymentsSketch() {
  return (
    <svg
      className="pointer-events-none absolute -right-3 top-8 h-32 w-40 overflow-visible text-foreground/70 transition-transform duration-500 ease-out motion-safe:group-hover:-rotate-2 motion-safe:group-hover:scale-[1.035]"
      viewBox="0 0 190 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M20 116C52 91 88 82 124 90C144 94 160 104 174 121"
        className="stroke-foreground/65 transition-transform duration-500 ease-out motion-safe:group-hover:translate-x-1 motion-safe:group-hover:-translate-y-1"
        strokeDasharray="6 9"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <g
        className="stroke-current transition-transform duration-500 ease-out motion-safe:group-hover:-translate-y-1"
        strokeLinejoin="round"
      >
        <rect
          x="44"
          y="38"
          width="76"
          height="82"
          rx="11"
          strokeWidth="1.8"
          transform="rotate(-8 82 79)"
        />
        <rect
          x="66"
          y="27"
          width="76"
          height="82"
          rx="11"
          className="fill-foreground/5"
          strokeWidth="2"
          transform="rotate(6 104 68)"
        />
        <path
          d="M84 53L124 57M82 70L129 75M80 87L111 91"
          className="stroke-foreground/40"
          strokeLinecap="round"
          strokeWidth="1.6"
          transform="rotate(6 104 68)"
        />
      </g>
      <g
        className="stroke-foreground transition-transform duration-500 ease-out motion-safe:group-hover:translate-x-2 motion-safe:group-hover:-translate-y-2"
        strokeWidth="2"
      >
        <circle cx="144" cy="104" r="24" className="fill-foreground/5" />
        <path
          d="M151 91C145 87 137 89 136 95C135 101 141 103 146 104C151 106 155 109 154 115C153 121 144 124 138 120M145 84V90M144 120V127"
          strokeLinecap="round"
        />
      </g>
      <circle
        cx="31"
        cy="55"
        r="8"
        className="stroke-foreground/30"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function WithdrawalMethodPicker({
  bulk,
  onWallet,
  onAnchor,
}: {
  bulk: boolean;
  onWallet: () => void;
  onAnchor: () => void;
}) {
  const moneyGramCashOutEnabled =
    moneyGramCashOutStatusEnabled && offRampEnabled;

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-semibold text-brand-linen">
        How would you like to withdraw?
      </legend>
      <button
        type="button"
        onClick={onWallet}
        className={`${glassInsetClass} flex min-h-20 items-center gap-4 border border-brand-linen/18 p-4 text-left transition-colors duration-200 hover:border-brand-linen/30 hover:bg-brand-linen/12 focus-visible:ring-2 focus-visible:ring-brand-linen/70`}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-linen/10 text-brand-linen ring-1 ring-brand-linen/15">
          <Wallet className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-brand-linen">
            Stellar wallet
          </span>
          <span className="mt-1 block text-xs leading-5 text-brand-linen/60">
            Private and on-chain. Send to a G… or C… Stellar address.
          </span>
        </span>
        <ArrowRight
          className="size-4 shrink-0 text-brand-linen/65"
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        onClick={onAnchor}
        disabled={bulk || !moneyGramCashOutEnabled}
        className={`${glassInsetClass} flex min-h-20 items-center gap-4 border border-brand-linen/18 p-4 text-left transition-colors duration-200 hover:border-brand-linen/30 hover:bg-brand-linen/12 focus-visible:ring-2 focus-visible:ring-brand-linen/70 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-brand-linen/18 disabled:hover:bg-brand-linen/8`}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-linen/10 text-brand-linen ring-1 ring-brand-linen/15">
          <Landmark className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-brand-linen">
            MoneyGram cash pickup
          </span>
          <span className="mt-1 block text-xs leading-5 text-brand-linen/60">
            {bulk
              ? "Cash anchors process one private payment at a time."
              : moneyGramRampStatus === "whitelisting"
                ? "Sandbox access pending. We’re completing MoneyGram integration and will enable cash pickup after approval."
                : moneyGramCashOutEnabled
                  ? "Cash out as local currency. Identity and payout details stay with the anchor."
                  : "MoneyGram cash pickup is unavailable on this network."}
          </span>
        </span>
        <ArrowRight
          className="size-4 shrink-0 text-brand-linen/65"
          aria-hidden="true"
        />
      </button>
    </fieldset>
  );
}

type WalletWithdrawalProps = {
  step: WalletStep;
  amount: bigint;
  paymentCount?: number;
  destination: string;
  submitError: string | null;
  fieldError?: string;
  registerDestination: ReturnType<
    ReturnType<typeof useForm<WithdrawFormInput>>["register"]
  >;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
};

function WalletWithdrawal({
  step,
  amount,
  paymentCount,
  destination,
  submitError,
  fieldError,
  registerDestination,
  onReview,
  onBack,
  onConfirm,
}: WalletWithdrawalProps) {
  if (step === "form") {
    return (
      <form className="grid gap-5" onSubmit={onReview} noValidate>
        <div className="grid gap-2">
          <Label className="text-brand-linen" htmlFor="withdraw-destination">
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
            <p
              id="withdraw-destination-hint"
              className="text-xs text-brand-linen/60"
            >
              Enter the external Stellar address that should receive the funds.
            </p>
          )}
        </div>

        {submitError ? <InlineError message={submitError} /> : null}

        <Button type="submit" variant="glass" size="lg" className="w-full">
          Review withdrawal
        </Button>
      </form>
    );
  }

  if (step === "review") {
    return (
      <div className="grid gap-5">
        <BackButton label="Edit details" onClick={onBack} />
        <div className={`${glassInsetClass} p-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-brand-linen/60">Cashing out</span>
            <span className="font-mono text-xl font-semibold text-brand-linen tabular-nums">
              {fromBaseUnits(amount)} USDC
            </span>
          </div>
          {paymentCount ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-brand-linen/12 pt-4">
              <span className="text-sm text-brand-linen/60">Payments</span>
              <span className="text-sm font-medium text-brand-linen">
                {paymentCount} separate proofs
              </span>
            </div>
          ) : null}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-brand-linen/12 pt-4">
            <span className="text-sm text-brand-linen/60">To</span>
            <span className="font-mono text-sm font-medium text-brand-linen">
              {shortAddress(destination.trim())}
            </span>
          </div>
        </div>
        {submitError ? <InlineError message={submitError} /> : null}
        <Button
          variant="glass"
          size="lg"
          className="w-full"
          onClick={onConfirm}
        >
          Confirm &amp; cash out
        </Button>
      </div>
    );
  }

  return (
    <div
      className="grid place-items-center gap-3 py-12 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-3">
        <Loader
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div className="text-sm font-semibold text-brand-linen">
          Generating proof and releasing funds…
        </div>
      </div>
      <div className="max-w-sm text-sm text-brand-linen/65">
        The zero-knowledge proof is built in your browser. This can take a few
        seconds.
      </div>
    </div>
  );
}

function BackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-fit items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-linen/70 hover:bg-brand-linen/8 hover:text-brand-linen focus-visible:ring-2 focus-visible:ring-brand-linen/70"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function LockedState({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="grid place-items-center gap-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-brand-linen/10 text-brand-linen ring-1 ring-brand-linen/15">
        <LockKeyhole className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-brand-linen">
          Unlock to cash out
        </h2>
        <p className="max-w-sm text-sm text-brand-linen/65">
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
      <div className="flex size-12 items-center justify-center rounded-lg bg-brand-linen/10 text-brand-linen ring-1 ring-brand-linen/15">
        <Banknote className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold text-brand-linen">
          No payments to cash out
        </h2>
        <p className="max-w-sm text-sm text-brand-linen/65">
          Share a payment link first. Private payments you receive will appear
          here.
        </p>
      </div>
      <Button
        variant="glass"
        nativeButton={false}
        render={<Link href={LINKS_PATH} />}
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
      className="grid gap-4 motion-safe:animate-pulse sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label="Loading private payments"
    >
      {["first", "second", "third"].map((key) => (
        <div
          key={key}
          className="min-h-64 rounded-xl bg-brand-linen/8 ring-1 ring-brand-linen/15 backdrop-blur-xl"
          aria-hidden="true"
        />
      ))}
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
    <ToastFeedback
      title="Could not load private payments"
      message={message}
      variant="error"
      toastId="private-payments-load-error"
      action={{ label: "Try again", onClick: onRetry }}
    />
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <ToastFeedback
      title="Withdrawal not completed"
      message={message}
      variant="error"
      toastId="wallet-withdrawal-error"
    />
  );
}
