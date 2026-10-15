"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ToastFeedback } from "../../../components/ui/toast-feedback";
import {
  type CctpChain,
  type CctpFeePreview,
  useCctpDeposit,
} from "../../../features/cctpPayer/hooks/useCctpDeposit";
import { useCctpRouteReadiness } from "../../../features/cctpPayer/hooks/useCctpRouteReadiness";
import { useEvmPayerWallet } from "../../../features/cctpPayer/hooks/useEvmPayerWallet";
import { SolanaWalletProvider } from "../../../features/cctpPayer/SolanaWalletProvider";
import { evmSourceForChain } from "../../../lib/cctp";
import { toBaseUnits } from "../../../lib/crypto";
import { api } from "../../../trpc/client";
import { FeeBreakdown } from "./FeeBreakdown";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "Use at most 6 decimal places")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero."),
});
type PayInput = z.infer<typeof payInput>;

type InvoiceBinding = { invoiceId: string; version: number } | null;

export function CctpPayForm(props: {
  username: string;
  notePubkey: Uint8Array;
  lockedAmount?: string | null;
  chain: CctpChain;
  invoice?: InvoiceBinding;
  disabled?: boolean;
}) {
  return (
    <SolanaWalletProvider>
      <CctpPayFormInner {...props} />
    </SolanaWalletProvider>
  );
}

function CctpPayFormInner({
  username,
  notePubkey,
  lockedAmount,
  chain,
  invoice = null,
  disabled = false,
}: {
  username: string;
  notePubkey: Uint8Array;
  lockedAmount?: string | null;
  chain: CctpChain;
  invoice?: InvoiceBinding;
  disabled?: boolean;
}) {
  const {
    phase,
    status,
    trackingError,
    start,
    hasPendingPayment,
    payments,
    exportRecovery,
  } = useCctpDeposit({
    username,
    notePubkey,
    invoice,
  });
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmSource = evmSourceForChain(chain);
  const evm = useEvmPayerWallet(evmSource);
  const { gate, recheck } = useCctpRouteReadiness(chain);
  const [preview, setPreview] = useState<CctpFeePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [feeChanged, setFeeChanged] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: lockedAmount ?? "" },
  });
  const enteredAmount = watch("amount");

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewRevision intentionally retries the same quote request.
  useEffect(() => {
    if (!/^\d+(\.\d{1,6})?$/.test(enteredAmount || "")) {
      setPreview(null);
      setPreviewError(null);
      setPreviewing(false);
      return;
    }
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      api.feeQuotes.preview
        .query({
          username,
          paymentAmount: toBaseUnits(enteredAmount).toString(),
          channel: "cctp",
        })
        .then((value) => {
          if (!cancelled) setPreview(value);
        })
        .catch((error) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError(
              error instanceof Error
                ? error.message
                : "The recipient's fee is temporarily unavailable.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enteredAmount, previewRevision, username]);

  const busy = phase !== "idle" && phase !== "done";
  const routeBlocked = gate.kind === "blocked" || gate.kind === "checking";

  useEffect(() => {
    reset({ amount: lockedAmount ?? "" });
  }, [lockedAmount, reset]);

  const onSubmit = handleSubmit(async ({ amount }) => {
    if (routeBlocked) return;
    setFeeChanged(null);
    let latest: CctpFeePreview;
    try {
      latest = await api.feeQuotes.preview.query({
        username,
        paymentAmount: toBaseUnits(amount).toString(),
        channel: "cctp",
      });
    } catch (error) {
      setPreview(null);
      setPreviewError(
        error instanceof Error
          ? error.message
          : "The recipient's fee is temporarily unavailable.",
      );
      return;
    }
    if (
      !preview ||
      latest.paymentAmount !== toBaseUnits(amount).toString() ||
      latest.paymentAmount !== preview.paymentAmount ||
      latest.feeBps !== preview.feeBps ||
      latest.totalAmount !== preview.totalAmount
    ) {
      setPreview(latest);
      setFeeChanged(
        "The recipient’s fee changed. Review the updated total and pay again.",
      );
      return;
    }
    if (chain === "solana") {
      return start(amount, latest, {
        chain: "solana",
        wallet: { publicKey, signTransaction },
        connection,
      });
    }
    return start(amount, latest, { chain });
  });

  const phaseLabel =
    phase === "burning"
      ? "Confirm the payment in your wallet…"
      : "Processing, please wait…";

  const idleHint =
    chain === "solana"
      ? "Pay with USDC from your Solana wallet. Your payment stays private."
      : evmSource
        ? `Pay with USDC on ${evmSource.name}. Your payment stays private.`
        : "Pay with USDC on Ethereum, Base, Arbitrum, or Avalanche. Your payment stays private.";

  return (
    <div className="grid gap-3">
      {chain === "solana" ? (
        <div className="flex justify-start [&_.wallet-adapter-button]:rounded-xl [&_.wallet-adapter-button]:bg-brand-linen/15 [&_.wallet-adapter-button]:text-brand-linen [&_.wallet-adapter-button]:ring-1 [&_.wallet-adapter-button]:ring-brand-linen/25 [&_.wallet-adapter-button]:backdrop-blur-xl [&_.wallet-adapter-button:hover]:bg-brand-linen/20">
          <WalletMultiButton />
        </div>
      ) : evmSource ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="glass"
            onClick={evm.connect}
            disabled={evm.connecting}
          >
            {evm.address
              ? `${evm.address.slice(0, 6)}…${evm.address.slice(-4)}`
              : "Connect wallet"}
          </Button>
          {evm.address && (
            <span className="text-xs text-brand-linen/65">
              {evm.onExpectedChain
                ? evmSource.name
                : `Switch to ${evmSource.name}`}
            </span>
          )}
          <ToastFeedback
            message={evm.error}
            variant="error"
            toastId="cctp-evm-wallet-error"
          />
        </div>
      ) : null}

      <ToastFeedback
        message={
          hasPendingPayment
            ? "Your payment is processing. You can close this page."
            : null
        }
        toastId="cctp-pending-payment"
        content={
          <div className="grid gap-2">
            <p>Your payment is processing. You can close this page.</p>
            <button
              type="button"
              className="justify-self-start text-sm underline underline-offset-4"
              onClick={exportRecovery}
            >
              Save payment backup
            </button>
          </div>
        }
      />
      {/* In-progress payments are covered by the toast above; only stuck ones get their own. */}
      {payments?.map((payment) => (
        <ToastFeedback
          key={payment.input.feeQuote.quote.quoteId}
          toastId={`cctp-payment-${payment.input.feeQuote.quote.quoteId}`}
          variant="error"
          message={
            payment.status?.stage === "needs_attention"
              ? "This payment is taking longer than usual. Save a payment backup to keep it safe."
              : null
          }
        />
      ))}
      <ToastFeedback
        message={trackingError}
        variant="error"
        toastId="cctp-payment-tracking"
      />

      <form className="grid gap-3" onSubmit={onSubmit}>
        <label
          className="text-sm font-semibold text-brand-linen"
          htmlFor="cctp-amount"
        >
          {chain === "solana"
            ? "USDC (from Solana)"
            : evmSource
              ? `USDC (from ${evmSource.name})`
              : "USDC (from another network)"}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            appearance="glass"
            id="cctp-amount"
            className="min-h-11 flex-1"
            inputMode="decimal"
            placeholder="5.00"
            disabled={busy}
            readOnly={Boolean(lockedAmount)}
            aria-readonly={Boolean(lockedAmount)}
            {...register("amount")}
          />
          <Button
            className="min-h-11"
            type="submit"
            disabled={
              busy || previewing || !preview || routeBlocked || disabled
            }
          >
            {busy && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {busy ? "Working…" : "Pay"}
          </Button>
        </div>
        <span className="text-xs leading-[1.0625rem] text-brand-linen/70">
          {busy ? phaseLabel : idleHint}
        </span>
        <ToastFeedback
          message={gate.kind === "blocked" ? gate.message : null}
          variant="error"
          toastId="cctp-route-unavailable"
          action={{ label: "Check again", onClick: recheck }}
        />
        <FeeBreakdown previewing={previewing} preview={preview} />
        <ToastFeedback
          message={previewError}
          variant="error"
          toastId="cctp-fee-preview-error"
          action={
            previewError
              ? {
                  label: "Try again",
                  onClick: () => setPreviewRevision((value) => value + 1),
                }
              : undefined
          }
        />
        <ToastFeedback
          message={feeChanged}
          variant="error"
          toastId="cctp-fee-changed"
        />
        <ToastFeedback
          message={errors.amount?.message}
          variant="error"
          toastId="cctp-amount-error"
        />
        <ToastFeedback
          message={status?.msg}
          variant={
            status?.kind === "ok"
              ? "success"
              : status?.kind === "info"
                ? "info"
                : "error"
          }
          toastId="cctp-payment-status"
        />
      </form>
    </div>
  );
}
