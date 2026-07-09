"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useWallet } from "./WalletProvider";
import {
  commitment,
  encryptNote,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32
} from "../lib/crypto";
import { poolDeposit, usdcBalance } from "../lib/stellar";
import { accountPubkeys, getAccount } from "../lib/notes";
import { btn, field, hint, inline, input, panel, status as statusClass } from "../lib/ui";

const depositInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero.")
});
type DepositInput = z.infer<typeof depositInput>;

// Self-deposit: shield the user's own USDC into the pool, committed to their
// own note pubkey and encrypted to their own view key — the same note the
// PayForm builds for a payee, but targeting the connected user.
export function DepositForm() {
  const { address, getSigner } = useWallet();
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<DepositInput>({ resolver: zodResolver(depositInput), defaultValues: { amount: "" } });

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    try {
      const acct = getAccount();
      if (!acct) {
        setStatus({ kind: "err", msg: "No account on this device. Claim a username first." });
        return;
      }
      const units = toBaseUnits(amount);
      const signer = getSigner();
      if ((await usdcBalance(signer.address)) < units) {
        setStatus({
          kind: "err",
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com."
        });
        return;
      }

      const { notePubkey, viewPubkey } = await accountPubkeys(acct);
      const salt = randomFieldElement();
      const note = toBE32(await commitment(units, fromBE(notePubkey), salt));
      const { ephemeralPk, ciphertext } = encryptNote(viewPubkey, units, salt);

      const leafIndex = await poolDeposit(signer, note, units, ephemeralPk, ciphertext);
      setStatus({ kind: "ok", msg: `Shielded ${amount} USDC into your account · note #${leafIndex}.` });
      reset({ amount: "" });
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Deposit failed." });
    }
  });

  return (
    <div className={panel}>
      <h2 className="text-lg font-semibold text-ink">Deposit to your stealth address</h2>
      <form className={field} onSubmit={onSubmit}>
        <label htmlFor="deposit-amount">USDC</label>
        <div className={inline}>
          <input
            id="deposit-amount"
            className={input}
            inputMode="decimal"
            placeholder="5.00"
            {...register("amount")}
          />
          <button className={btn} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Depositing…" : "Deposit"}
          </button>
        </div>
        <span className={hint}>
          {address
            ? "Shields your own USDC into the pool as a private note only you can spend."
            : "Connect a wallet (top right) to deposit."}
        </span>
        {errors.amount ? <div className={statusClass("err")}>{errors.amount.message}</div> : null}
        {status ? <div className={statusClass(status.kind)}>{status.msg}</div> : null}
      </form>
    </div>
  );
}
