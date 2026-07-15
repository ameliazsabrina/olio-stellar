"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
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
import { Input } from "../../../components/ui/input";
import { ToastFeedback } from "../../../components/ui/toast-feedback";
import type { CctpChain } from "../../../features/cctpPayer/hooks/useCctpDeposit";
import { usePayerWallet } from "../../../features/payerWallet/hooks/usePayerWallet";
import { kitSigner } from "../../../features/payerWallet/kitSigner";
import type { PaymentLink } from "../../../features/paymentLinks/types";
import { cctpIntakeContract } from "../../../lib/cctp";
import {
  commitment,
  encryptNote,
  fromBaseUnits,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32,
} from "../../../lib/crypto";
import {
  explorerTxUrl,
  type OlioAccount,
  poolDeposit,
  usdcBalance,
} from "../../../lib/stellar";
import { CctpPayForm } from "./CctpPayForm";

type Method = "stellar" | "cctp";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
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
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
    url?: string;
  } | null>(null);
  const cctpEnabled = Boolean(cctpIntakeContract);

  const lockedAmount =
    link && link.owner === username && link.amount
      ? fromBaseUnits(BigInt(link.amount))
      : null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: lockedAmount ?? "" },
  });

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
      const signer = kitSigner(address);
      if ((await usdcBalance(signer.address)) < units) {
        setStatus({
          kind: "err",
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com.",
        });
        return;
      }

      const salt = randomFieldElement();
      const ownerPkField = fromBE(account.note_pubkey);
      const note = toBE32(await commitment(units, ownerPkField, salt));
      const { ephemeralPk, ciphertext } = encryptNote(
        account.view_pubkey,
        units,
        salt,
      );

      const { leafIndex, txHash } = await poolDeposit(
        signer,
        note,
        units,
        ephemeralPk,
        ciphertext,
      );
      setStatus({
        kind: "ok",
        msg: `Sent ${amount} USDC to @${username}. See the proof here.`,
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
    <Card appearance="glass" className="gap-4 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">
          {lockedAmount ? "Requested amount" : "Amount"}
        </h2>
        {link?.label ? (
          <span className="truncate text-sm text-white/60">{link.label}</span>
        ) : null}
      </div>

      {cctpEnabled && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/7 p-1 ring-1 ring-white/12 backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              setStatus(null);
              setMethod("stellar");
            }}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white/70 ${
              method === "stellar"
                ? "bg-white/15 text-white ring-1 ring-white/20"
                : "text-white/55 hover:bg-white/8 hover:text-white"
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

          <DropdownMenu>
            <DropdownMenuTrigger
              className={`group flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white/70 ${
                method === "cctp"
                  ? "bg-white/15 text-white ring-1 ring-white/20"
                  : "text-white/55 hover:bg-white/8 hover:text-white"
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
                className="min-h-12 cursor-pointer gap-3 px-3 text-white focus:bg-white/14 focus:text-white"
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
                disabled
                className="min-h-12 gap-3 px-3 text-white/60 opacity-100 data-disabled:opacity-100"
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
                  <span className="text-xs font-normal text-white/45">
                    (under development)
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <label className="text-sm font-semibold text-white" htmlFor="amount">
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
                variant="glass"
                className="min-h-11"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Paying…" : "Pay"}
              </Button>
            ) : (
              <Button
                variant="glass"
                className="min-h-11"
                type="button"
                onClick={connect}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : "Connect wallet"}
              </Button>
            )}
          </div>
          <span className="text-xs text-white/55">
            {address
              ? `Paying from ${address.slice(0, 4)}…${address.slice(-4)} — gasless, you only need USDC.`
              : "Pay with your own Stellar wallet (Freighter, xBull, LOBSTR…)."}
          </span>
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
