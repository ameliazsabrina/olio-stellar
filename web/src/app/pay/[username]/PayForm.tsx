"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Loader } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { glassSegmentedClass } from "../../../components/ui/glass";
import { Input } from "../../../components/ui/input";
import { ToastFeedback } from "../../../components/ui/toast-feedback";
import type { CctpChain } from "../../../features/cctpPayer/hooks/useCctpDeposit";
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
  explorerTxUrl,
  type OlioAccount,
  poolDeposit,
  usdcBalance,
} from "../../../lib/stellar";
import { cn } from "../../../lib/utils";
import { api } from "../../../trpc/client";
import { CctpPayForm } from "./CctpPayForm";

type Method = "stellar" | "cctp";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "Use at most 7 decimal places")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero."),
});
type PayInput = z.infer<typeof payInput>;

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
    feeBps: 200 | 500;
    feeAmount: string;
    totalAmount: string;
    policyVersion: 2;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
    url?: string;
  } | null>(null);
  const cctpEnabled = Boolean(cctpIntakeContract);
  const methodCount = 1 + Number(cctpEnabled);

  const lockedAmount =
    link && link.owner === username && link.amount
      ? fromBaseUnits(BigInt(link.amount))
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

  useEffect(() => {
    if (
      method !== "stellar" ||
      !/^\d+(\.\d{1,7})?$/.test(enteredAmount || "")
    ) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    let cancelled = false;
    setPreview(null);
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
            setStatus({
              kind: "err",
              msg:
                error instanceof Error
                  ? error.message
                  : "Fee quote is unavailable.",
            });
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
  }, [enteredAmount, method, username]);

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
      const units = toBaseUnits(amount);
      if (!preview || preview.paymentAmount !== units.toString()) {
        throw new Error("Wait for the current fee quote before paying.");
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
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com.",
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

      const { txHash } = await poolDeposit(
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
        msg: `Sent ${amount} USDC to @${username}; total charged ${fromBaseUnits(feeQuote.quote.totalAmount)} USDC. See the proof here.`,
        url: explorerTxUrl(txHash),
      });
      reset({ amount: lockedAmount ?? "" });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Payment failed.",
      });
    }
  });

  return (
    <Card appearance="glass" density="spacious" className="gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-product-panel-title text-brand-linen">
          {lockedAmount ? "Requested amount" : "Amount"}
        </h2>
        {link?.label ? (
          <span className="truncate text-sm text-brand-linen/60">
            {link.label}
          </span>
        ) : null}
      </div>

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
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-linen/70 ${
              method === "stellar"
                ? "bg-brand-linen/15 text-brand-linen ring-1 ring-brand-linen/20"
                : "text-brand-linen/55 hover:bg-brand-linen/8 hover:text-brand-linen"
            }`}
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
                className={`group flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-linen/70 ${
                  method === "cctp"
                    ? "bg-brand-linen/15 text-brand-linen ring-1 ring-brand-linen/20"
                    : "text-brand-linen/55 hover:bg-brand-linen/8 hover:text-brand-linen"
                }`}
                aria-label="Select another chain"
              >
                <span>Another chain</span>
                <ChevronDown
                  className="size-4 transition-transform group-data-[popup-open]:rotate-180"
                  aria-hidden="true"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                appearance="glass"
                align="end"
                sideOffset={8}
                className="p-2"
              >
                <DropdownMenuItem
                  className="min-h-12 cursor-pointer gap-3 px-3 text-brand-linen focus:bg-brand-linen/14 focus:text-brand-linen"
                  onClick={() => {
                    setStatus(null);
                    setCctpChain("solana");
                    setMethod("cctp");
                  }}
                >
                  <Image
                    src="/assets/sol.png"
                    alt=""
                    width={28}
                    height={28}
                    className="size-7 rounded-full"
                  />
                  Solana
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-12 cursor-pointer gap-3 px-3 text-brand-linen focus:bg-brand-linen/14 focus:text-brand-linen"
                  onClick={() => {
                    setStatus(null);
                    setCctpChain("base");
                    setMethod("cctp");
                  }}
                >
                  <Image
                    src="/assets/base.png"
                    alt=""
                    width={28}
                    height={28}
                    className="size-7 rounded-full"
                  />
                  Base
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled
                  className="min-h-12 gap-3 px-3 text-brand-linen/60 opacity-100 data-disabled:opacity-100"
                >
                  <Image
                    src="/assets/eth.png"
                    alt=""
                    width={28}
                    height={28}
                    className="size-7 rounded-full"
                  />
                  <span className="grid gap-0.5">
                    <span>EVM Chains</span>
                    <span className="text-xs font-normal text-brand-linen/45">
                      (under development)
                    </span>
                  </span>
                </DropdownMenuItem>
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
        />
      ) : (
        <form className="grid gap-2" onSubmit={onSubmit}>
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
                disabled={isSubmitting || previewing || !preview}
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
          <span className="text-xs text-brand-linen/55">
            {address
              ? `Paying from ${address.slice(0, 4)}…${address.slice(-4)} — gasless, you only need USDC.`
              : "Pay with your own Stellar wallet (Freighter, xBull, LOBSTR…)."}
          </span>
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
            message={status?.msg}
            content={
              status?.kind === "ok" && status.url
                ? (() => {
                    const [before, after] = status.msg.split("here");
                    return (
                      <span>
                        {before}
                        <a
                          href={status.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View transaction proof in Stellar Explorer"
                          className="underline underline-offset-2"
                        >
                          here
                        </a>
                        {after}
                      </span>
                    );
                  })()
                : undefined
            }
            variant={status?.kind === "ok" ? "success" : "error"}
            toastId="payment-status"
          />
        </form>
      )}
    </Card>
  );
}
