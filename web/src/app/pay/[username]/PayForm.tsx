"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { useWallet } from "../../../components/WalletProvider";
import {
  commitment,
  encryptNote,
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
}: {
  account: OlioAccount;
  username: string;
}) {
  const { address, getSigner } = useWallet();
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: "" },
  });

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    try {
      const units = toBaseUnits(amount);
      const signer = getSigner();
      if ((await usdcBalance(signer.address)) < units) {
        setStatus({
          kind: "err",
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com.",
        });
        return;
      }

      // Build a shielded note the recipient can spend, with metadata encrypted to them.
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
      reset({ amount: "" });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Payment failed.",
      });
    }
  });

  return (
    <Card className="gap-3 p-6">
      <h2 className="text-lg font-semibold text-ink">Amount</h2>
      <form className="grid gap-2" onSubmit={onSubmit}>
        <label htmlFor="amount">USDC</label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="amount"
            className="min-h-11 flex-1"
            inputMode="decimal"
            placeholder="5.00"
            {...register("amount")}
          />
          <Button className="min-h-11" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Paying…" : "Pay"}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {address
            ? "Paying from your connected wallet."
            : "Connect a wallet (top right) to pay."}
        </span>
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
