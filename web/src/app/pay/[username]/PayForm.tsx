"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Loader } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DashboardTile } from "../../../components/dashboard/DashboardTile";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { glassSegmentedClass } from "../../../components/ui/glass";
import { Input } from "../../../components/ui/input";
import { ToastFeedback } from "../../../components/ui/toast-feedback";
import { CctpChainMenuItems } from "../../../features/cctpPayer/CctpChainMenuItems";
import type { CctpChain } from "../../../features/cctpPayer/hooks/useCctpDeposit";
import { usePublicInvoice } from "../../../features/invoices/usePublicInvoice";
import { usePayerWallet } from "../../../features/payerWallet/hooks/usePayerWallet";
import { kitSigner } from "../../../features/payerWallet/kitSigner";
import type { PaymentLink } from "../../../features/paymentLinks/types";
import { cctpIntakeContract } from "../../../lib/cctp";
import {
  bytesToHex,
  commitment,
  encryptNote,
  fromBaseUnits,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32,
} from "../../../lib/crypto";
import { deserializeFeeQuoteEnvelope } from "../../../lib/fee-quote";
import { proveDeposit } from "../../../lib/prover";
import {
  type OlioAccount,
  poolDeposit,
  usdcBalance,
} from "../../../lib/stellar";
import { cn } from "../../../lib/utils";
import { api } from "../../../trpc/client";
import { CctpPayForm } from "./CctpPayForm";
import { FeeBreakdown } from "./FeeBreakdown";
import { InvoicePaySummary } from "./InvoicePaySummary";

type Method = "stellar" | "cctp";

// Active segment mirrors the dashboard rail's selected item.
const segmentClass = (active: boolean) =>
  cn(
    "flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen",
    active
      ? "bg-brand-linen !text-brand-obsidian"
      : "text-brand-linen/88 hover:bg-brand-linen/10 hover:text-brand-linen",
  );

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "Use at most 7 decimal places")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero."),
});
type PayInput = z.infer<typeof payInput>;

// Network and contract errors arrive as raw host text; payers only need to know whether to wait or retry.
function friendlyPayError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/NOT_FOUND/.test(message))
    return "Your payment is taking longer than usual. Check your wallet before trying again.";
  if (/Error\(Contract,\s*#10\)/.test(message))
    return "Payments are paused right now. Please try again later.";
  if (!message || /HostError|Error\(|Transaction failed|simulat/i.test(message))
    return "Payment didn't go through. Please try again.";
  return message;
}

export function PayForm({
  account,
  username,
  link,
}: {
  account: OlioAccount;
  username: string;
  link?: PaymentLink | null;
}) {
  const { address, connecting, error: walletError, connect } = usePayerWallet();
  const [method, setMethod] = useState<Method>("stellar");
  const [cctpChain, setCctpChain] = useState<CctpChain>("evm");
  const [preview, setPreview] = useState<{
    paymentAmount: string;
    feeBps: 200;
    feeAmount: string;
    totalAmount: string;
    policyVersion: 2;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);
  const cctpEnabled = Boolean(cctpIntakeContract);
  const methodCount = 1 + Number(cctpEnabled);
  const invoiceId = link && link.owner === username ? link.invoiceId : null;
  const invoiceView = usePublicInvoice(invoiceId);
  const payableVersion = invoiceView.invoice?.payable
    ? invoiceView.invoice.version
    : null;
  const invoiceBinding = useMemo(
    () =>
      invoiceId && payableVersion !== null
        ? { invoiceId, version: payableVersion }
        : null,
    [invoiceId, payableVersion],
  );
  const invoiceBlocked = Boolean(invoiceId) && !invoiceBinding;

  const lockedAmount =
    link && link.owner === username && link.amount
      ? fromBaseUnits(BigInt(link.amount))
      : invoiceBinding && invoiceView.invoice
        ? fromBaseUnits(BigInt(invoiceView.invoice.remainingAmount))
        : null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: lockedAmount ?? "" },
  });
  const enteredAmount = watch("amount");

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewRevision intentionally retries the same quote request.
  useEffect(() => {
    if (
      method !== "stellar" ||
      !/^\d+(\.\d{1,7})?$/.test(enteredAmount || "")
    ) {
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
          channel: "direct",
        })
        .then((value) => {
          if (!cancelled) setPreview(value);
        })
        .catch((error) => {
          if (!cancelled) {
            setPreviewError(
              error instanceof Error
                ? error.message
                : "The recipient’s fee is temporarily unavailable.",
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
  }, [enteredAmount, method, previewRevision, username]);

  useEffect(() => {
    reset({ amount: lockedAmount ?? "" });
  }, [lockedAmount, reset]);

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    if (!address) {
      setStatus({ kind: "err", msg: "Connect your wallet to pay." });
      return;
    }
    try {
      if (invoiceBlocked) {
        throw new Error("This invoice is not open for payment.");
      }
      const units = toBaseUnits(amount);
      if (!preview || preview.paymentAmount !== units.toString()) {
        throw new Error("Still working out the fee. Please wait a moment.");
      }
      const signer = kitSigner(address);
      const salt = randomFieldElement();
      const ownerPkField = fromBE(account.note_pubkey);
      const note = toBE32(await commitment(units, ownerPkField, salt));
      const issued = await api.feeQuotes.issue.mutate({
        username,
        paymentAmount: units.toString(),
        channel: "direct",
        depositor: signer.address,
        commitment: bytesToHex(note),
        salt: bytesToHex(toBE32(salt)),
        ...(invoiceBinding ? { invoice: invoiceBinding } : {}),
      });
      const feeQuote = deserializeFeeQuoteEnvelope(issued);
      if (
        issued.quote.feeBps !== preview.feeBps ||
        issued.quote.feeAmount !== preview.feeAmount ||
        issued.quote.totalAmount !== preview.totalAmount
      ) {
        setPreview({
          paymentAmount: issued.quote.paymentAmount,
          feeBps: issued.quote.feeBps,
          feeAmount: issued.quote.feeAmount,
          totalAmount: issued.quote.totalAmount,
          policyVersion: issued.quote.policyVersion,
        });
        throw new Error(
          "The recipient’s fee changed. Review the updated total and pay again.",
        );
      }
      if ((await usdcBalance(signer.address)) < feeQuote.quote.totalAmount) {
        setStatus({
          kind: "err",
          msg: "Not enough USDC in your wallet. Add USDC to your wallet and get test funds at faucet.circle.com.",
        });
        return;
      }
      const { proof } = await proveDeposit({
        commitment: fromBE(note).toString(),
        amount: units.toString(),
        ownerPk: ownerPkField.toString(),
        salt: salt.toString(),
      });
      const { ephemeralPk, ciphertext } = encryptNote(
        account.view_pubkey,
        units,
        salt,
      );

      await poolDeposit(
        signer,
        note,
        units,
        feeQuote,
        proof,
        ephemeralPk,
        ciphertext,
      );
      setStatus({
        kind: "ok",
        msg: `Sent ${amount} USDC to @${username}; total charged ${fromBaseUnits(feeQuote.quote.totalAmount)} USDC. It can take a while for @${username} to receive it.${invoiceBinding ? " The invoice updates once it arrives." : ""}`,
      });
      reset({ amount: lockedAmount ?? "" });
    } catch (e) {
      setStatus({ kind: "err", msg: friendlyPayError(e) });
    }
  });

  return (
    <>
      {invoiceId ? <InvoicePaySummary view={invoiceView} /> : null}
      <DashboardTile
        appearance="glass"
        className="min-h-0 text-brand-linen"
        header={
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="dashboard-tile-title">
              {lockedAmount ? "Requested amount" : "Amount"}
            </h2>
            {link?.label ? (
              <span className="truncate text-[0.8125rem] leading-[1.1875rem] text-brand-linen/70">
                {link.label}
              </span>
            ) : null}
          </div>
        }
        content={
          <div className="mt-5 grid gap-5">
            {methodCount > 1 && (
              <div
                className={cn(
                  glassSegmentedClass,
                  "grid gap-1 p-1",
                  methodCount === 3 ? "grid-cols-3" : "grid-cols-2",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    setMethod("stellar");
                  }}
                  className={segmentClass(method === "stellar")}
                >
                  <Image
                    src="/assets/stellar-black.webp"
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 rounded-full object-cover"
                  />
                  <span>Stellar wallet</span>
                </button>

                {cctpEnabled && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn("group", segmentClass(method === "cctp"))}
                      aria-label="Select another network"
                    >
                      <span>Another network</span>
                      <ChevronDown
                        className="size-4 transition-transform group-data-[popup-open]:rotate-180"
                        aria-hidden="true"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      appearance="glass"
                      align="end"
                      sideOffset={8}
                      className="max-h-[min(26rem,var(--available-height))] p-2"
                    >
                      <CctpChainMenuItems
                        onSelect={(chain) => {
                          setStatus(null);
                          setCctpChain(chain);
                          setMethod("cctp");
                        }}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}

            {method === "cctp" ? (
              <CctpPayForm
                username={username}
                notePubkey={account.note_pubkey}
                lockedAmount={lockedAmount}
                chain={cctpChain}
                invoice={invoiceBinding}
                disabled={invoiceBlocked}
              />
            ) : (
              <form className="grid gap-3" onSubmit={onSubmit}>
                <label
                  className="text-sm font-semibold text-brand-linen"
                  htmlFor="amount"
                >
                  USDC
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    appearance="glass"
                    id="amount"
                    className="min-h-11 flex-1"
                    inputMode="decimal"
                    placeholder="5.00"
                    readOnly={Boolean(lockedAmount)}
                    aria-readonly={Boolean(lockedAmount)}
                    {...register("amount")}
                  />
                  {address ? (
                    <Button
                      // variant="glass"
                      className="min-h-11"
                      type="submit"
                      disabled={
                        isSubmitting || previewing || !preview || invoiceBlocked
                      }
                    >
                      {isSubmitting && (
                        <Loader
                          className="size-4 motion-safe:animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {isSubmitting ? "Paying…" : "Pay"}
                    </Button>
                  ) : (
                    <Button
                      className="min-h-11"
                      type="button"
                      onClick={connect}
                      disabled={connecting}
                    >
                      {connecting && (
                        <Loader
                          className="size-4 motion-safe:animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {connecting ? "Connecting…" : "Connect wallet"}
                    </Button>
                  )}
                </div>
                <span className="text-xs leading-[1.0625rem] text-brand-linen/70">
                  {address
                    ? `Paying from ${address.slice(0, 4)}…${address.slice(-4)}. No network fees, you only need USDC.`
                    : "Pay with your own Stellar wallet (Freighter, xBull, LOBSTR…)."}
                </span>
                <FeeBreakdown previewing={previewing} preview={preview} />
                <ToastFeedback
                  message={walletError}
                  variant="error"
                  toastId="payer-wallet-error"
                />
                <ToastFeedback
                  message={errors.amount?.message}
                  variant="error"
                  toastId="payment-amount-error"
                />
                <ToastFeedback
                  message={previewError}
                  variant="error"
                  toastId="payment-fee-preview-error"
                  action={
                    previewError
                      ? {
                          label: "Try again",
                          onClick: () =>
                            setPreviewRevision((value) => value + 1),
                        }
                      : undefined
                  }
                />
                <ToastFeedback
                  message={status?.msg}
                  variant={status?.kind === "ok" ? "success" : "error"}
                  toastId="payment-status"
                />
              </form>
            )}
          </div>
        }
      />
    </>
  );
}
