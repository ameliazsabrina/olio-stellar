"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useWallet } from "../../../components/WalletProvider";
import {
  commitment,
  encryptNote,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32
} from "../../../lib/crypto";
import { poolDeposit, usdcBalance, type OlioAccount } from "../../../lib/stellar";
import { btn, field, hint, inline, input, panel, status as statusClass } from "../../../lib/ui";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero.")
});
type PayInput = z.infer<typeof payInput>;

export function PayForm({ account, username }: { account: OlioAccount; username: string }) {
  const { address, getSigner } = useWallet();
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<PayInput>({ resolver: zodResolver(payInput), defaultValues: { amount: "" } });

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    try {
      const units = toBaseUnits(amount);
      const signer = getSigner();
      if ((await usdcBalance(signer.address)) < units) {
        setStatus({
          kind: "err",
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com."
        });
        return;
      }

      // Build a shielded note the recipient can spend, with metadata encrypted to them.
      const salt = randomFieldElement();
      const ownerPkField = fromBE(account.note_pubkey);
      const note = toBE32(await commitment(units, ownerPkField, salt));
      const { ephemeralPk, ciphertext } = encryptNote(account.view_pubkey, units, salt);

      const leafIndex = await poolDeposit(signer, note, units, ephemeralPk, ciphertext);
      setStatus({ kind: "ok", msg: `Paid ${amount} USDC to @${username}. Private note #${leafIndex} delivered.` });
      reset({ amount: "" });
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Payment failed." });
    }
  });

  return (
    <div className={panel}>
      <h2 className="text-lg font-semibold text-ink">Amount</h2>
      <form className={field} onSubmit={onSubmit}>
        <label htmlFor="amount">USDC</label>
        <div className={inline}>
          <input
            id="amount"
            className={input}
            inputMode="decimal"
            placeholder="5.00"
            {...register("amount")}
          />
          <button className={btn} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Paying…" : "Pay"}
          </button>
        </div>
        <span className={hint}>
          {address ? "Paying from your connected wallet." : "Connect a wallet (top right) to pay."}
        </span>
        {errors.amount ? <div className={statusClass("err")}>{errors.amount.message}</div> : null}
        {status ? <div className={statusClass(status.kind)}>{status.msg}</div> : null}
      </form>
    </div>
  );
}
