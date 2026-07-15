"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  commitment,
  encryptNote,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32,
} from "../lib/crypto";
import { accountPubkeys, getAccount } from "../lib/notes";
import { poolDeposit, usdcBalance } from "../lib/stellar";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { ToastFeedback } from "./ui/toast-feedback";
import { useWallet } from "./WalletProvider";

const depositInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero."),
});
type DepositInput = z.infer<typeof depositInput>;

// Self-deposit: shield the user's own USDC into the pool, committed to their
// own note pubkey and encrypted to their own view key — the same note the
// PayForm builds for a payee, but targeting the connected user.
export function DepositForm() {
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
  } = useForm<DepositInput>({
    resolver: zodResolver(depositInput),
    defaultValues: { amount: "" },
  });

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    try {
      const acct = getAccount();
      if (!acct) {
        setStatus({
          kind: "err",
          msg: "No account on this device. Claim a username first.",
        });
        return;
      }
      const units = toBaseUnits(amount);
      const signer = getSigner();
      if ((await usdcBalance(signer.address)) < units) {
        setStatus({
          kind: "err",
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com.",
        });
        return;
      }

      const { notePubkey, viewPubkey } = await accountPubkeys(acct);
      const salt = randomFieldElement();
      const note = toBE32(await commitment(units, fromBE(notePubkey), salt));
      const { ephemeralPk, ciphertext } = encryptNote(viewPubkey, units, salt);

      const leafIndex = await poolDeposit(
        signer,
        note,
        units,
        ephemeralPk,
        ciphertext,
      );
      setStatus({
        kind: "ok",
        msg: `Shielded ${amount} USDC into your account.`,
      });
      reset({ amount: "" });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Deposit failed.",
      });
    }
  });

  return (
    <Card className="gap-3 p-6">
      <h2 className="text-lg font-semibold text-ink">Add your own USDC</h2>
      <form className="grid gap-2" onSubmit={onSubmit}>
        <label htmlFor="deposit-amount">USDC</label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="deposit-amount"
            className="min-h-11 flex-1"
            inputMode="decimal"
            placeholder="5.00"
            {...register("amount")}
          />
          <Button className="min-h-11" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Depositing…" : "Deposit"}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {address
            ? "Shields your own USDC into the pool as a private note only you can spend."
            : "Connect a wallet (top right) to deposit."}
        </span>
        <ToastFeedback
          message={errors.amount?.message}
          variant="error"
          toastId="deposit-amount-error"
        />
        <ToastFeedback
          message={status?.msg}
          variant={status?.kind === "ok" ? "success" : "error"}
          toastId="deposit-status"
        />
      </form>
    </Card>
  );
}
