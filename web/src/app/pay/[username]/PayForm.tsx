"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { usePayerWallet } from "../../../features/payerWallet/hooks/usePayerWallet";
import { kitSigner } from "../../../features/payerWallet/kitSigner";
import type { PaymentLink } from "../../../features/paymentLinks/types";
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
  type OlioAccount,
  poolDeposit,
  usdcBalance,
} from "../../../lib/stellar";

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
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);

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

      const leafIndex = await poolDeposit(
        signer,
        note,
        units,
        ephemeralPk,
        ciphertext,
      );
      setStatus({
        kind: "ok",
        msg: `Paid ${amount} USDC to @${username}. Private note #${leafIndex} delivered.`,
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
    <Card className="gap-3 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">
          {lockedAmount ? "Requested amount" : "Amount"}
        </h2>
        {link?.label ? (
          <span className="truncate text-sm text-muted-foreground">
            {link.label}
          </span>
        ) : null}
      </div>
      <form className="grid gap-2" onSubmit={onSubmit}>
        <label htmlFor="amount">USDC</label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="amount"
            className="min-h-11 flex-1"
            inputMode="decimal"
            placeholder="5.00"
            readOnly={Boolean(lockedAmount)}
            aria-readonly={Boolean(lockedAmount)}
            {...register("amount")}
          />
          {address ? (
            <Button className="min-h-11" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Paying…" : "Pay"}
            </Button>
          ) : (
            <Button
              className="min-h-11"
              type="button"
              onClick={connect}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {address
            ? `Paying from ${address.slice(0, 4)}…${address.slice(-4)} — gasless, you only need USDC.`
            : "Pay with your own Stellar wallet (Freighter, xBull, LOBSTR…)."}
        </span>
        {walletError ? (
          <Alert variant="destructive">
            <AlertDescription>{walletError}</AlertDescription>
          </Alert>
        ) : null}
        {errors.amount ? (
          <Alert variant="destructive">
            <AlertDescription>{errors.amount.message}</AlertDescription>
          </Alert>
        ) : null}
        {status ? (
          <Alert variant={status.kind === "ok" ? "success" : "destructive"}>
            <AlertDescription>{status.msg}</AlertDescription>
          </Alert>
        ) : null}
      </form>
    </Card>
  );
}
