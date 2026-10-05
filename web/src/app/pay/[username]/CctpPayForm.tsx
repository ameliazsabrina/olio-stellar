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
import { fromBaseUnits, toBaseUnits } from "../../../lib/crypto";
import { api } from "../../../trpc/client";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "Use at most 6 decimal places")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero."),
});
type PayInput = z.infer<typeof payInput>;

export function CctpPayForm(props: {
  username: string;
  notePubkey: Uint8Array;
  lockedAmount?: string | null;
  chain: CctpChain;
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
}: {
  username: string;
  notePubkey: Uint8Array;
  lockedAmount?: string | null;
  chain: CctpChain;
}) {
  const { phase, status, start, hasPendingPayment, payments, exportRecovery } =
    useCctpDeposit({
      username,
      notePubkey,
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
      ? "Confirm payment in your wallet…"
      : phase === "attesting"
        ? "Waiting for confirmation…"
        : phase === "relaying"
          ? "Completing payment…"
          : "Confirm payment";

  const idleHint =
    chain === "solana"
      ? "Burn USDC on Solana — it arrives as a private note."
      : evmSource
        ? `Burn USDC on ${evmSource.name} — it arrives as a private note.`
        : "Burn USDC on Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or Avalanche Fuji — it arrives as a private note.";

  return (
    <div className="grid gap-2">
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
            ? "A previous payment is still being completed automatically — you can close this page. You can also send another payment now."
            : null
        }
        toastId="cctp-pending-payment"
        content={
          <div className="grid gap-2">
            <p>
              A previous payment is still being completed automatically — you
              can close this page. You can also send another payment now.
            </p>
            <button
              type="button"
              className="justify-self-start text-sm underline underline-offset-4"
              onClick={exportRecovery}
            >
              Export payment recovery
            </button>
          </div>
        }
      />
      {payments?.map((payment) => (
        <ToastFeedback
          key={payment.input.feeQuote.quote.quoteId}
          toastId={`cctp-payment-${payment.input.feeQuote.quote.quoteId}`}
          variant={
            payment.status?.stage === "needs_attention" ? "error" : "info"
          }
          message={
            payment.status?.stage === "completed"
              ? null
              : payment.status?.stage === "needs_attention"
                ? "Payment needs attention. Recovery remains saved."
                : payment.sourceTxHash
                  ? "Payment submitted — waiting for confirmation"
                  : "Payment preparation saved"
          }
        />
      ))}

      <form className="grid gap-2" onSubmit={onSubmit}>
        <label
          className="text-sm font-semibold text-brand-linen"
          htmlFor="cctp-amount"
        >
          {chain === "solana"
            ? "USDC (from Solana devnet)"
            : evmSource
              ? `USDC (from ${evmSource.name})`
              : "USDC (from an EVM chain)"}
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
            disabled={busy || previewing || !preview || routeBlocked}
          >
            {busy && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {busy ? "Working…" : "Pay via CCTP"}
          </Button>
        </div>
        <span className="text-xs text-brand-linen/55">
          {busy ? phaseLabel : idleHint}
        </span>
        <ToastFeedback
          message={gate.kind === "blocked" ? gate.message : null}
          variant="error"
          toastId="cctp-route-unavailable"
          action={{ label: "Check again", onClick: recheck }}
        />
        {previewing ? (
          <p
            className="text-sm text-brand-linen/65"
            role="status"
            aria-live="polite"
          >
            Checking the recipient’s fee…
          </p>
        ) : preview ? (
          <dl
            className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-brand-linen/15 p-3 text-sm text-brand-linen/75"
            aria-label="Payment breakdown"
            aria-live="polite"
            aria-atomic="true"
          >
            <dt>Payment amount</dt>
            <dd className="text-right">
              {fromBaseUnits(BigInt(preview.paymentAmount))} USDC
            </dd>
            <dt>Olio service fee ({preview.feeBps / 100}%)</dt>
            <dd className="text-right">
              {fromBaseUnits(BigInt(preview.feeAmount))} USDC
            </dd>
            <dt className="font-semibold text-brand-linen">Total</dt>
            <dd className="text-right font-semibold text-brand-linen">
              {fromBaseUnits(BigInt(preview.totalAmount))} USDC
            </dd>
            <dt>Recipient receives</dt>
            <dd className="text-right">
              {fromBaseUnits(BigInt(preview.paymentAmount))} USDC
            </dd>
          </dl>
        ) : null}
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
          message={errors.amount?.message}
          variant="error"
          toastId="cctp-amount-error"
        />
        <ToastFeedback
          message={status?.msg}
          variant={status?.kind === "ok" ? "success" : "error"}
          toastId="cctp-payment-status"
        />
      </form>
    </div>
  );
}
