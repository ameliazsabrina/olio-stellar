"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Loader } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ToastFeedback } from "../../../components/ui/toast-feedback";
import {
  type CctpChain,
  useCctpDeposit,
} from "../../../features/cctpPayer/hooks/useCctpDeposit";
import { SolanaWalletProvider } from "../../../features/cctpPayer/SolanaWalletProvider";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Enter an amount greater than zero."),
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
  const { phase, status, start, retry, canRetry } = useCctpDeposit({
    username,
    notePubkey,
  });
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: lockedAmount ?? "" },
  });

  const busy = phase !== "idle" && phase !== "done";

  useEffect(() => {
    reset({ amount: lockedAmount ?? "" });
  }, [lockedAmount, reset]);

  const onSubmit = handleSubmit(({ amount }) => {
    if (chain === "solana") {
      return start(amount, {
        chain: "solana",
        wallet: { publicKey, signTransaction },
        connection,
      });
    }
    return start(amount, { chain: "evm" });
  });

  const phaseLabel =
    phase === "burning"
      ? "Confirm the burn in your wallet…"
      : phase === "attesting"
        ? "Waiting for Circle's attestation…"
        : phase === "relaying"
          ? "Minting on Stellar & delivering the note…"
          : "Pay from another chain";

  const idleHint =
    chain === "solana"
      ? "Burn devnet USDC on Solana — it arrives as a private note."
      : "Burn USDC on Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or Avalanche Fuji — it arrives as a private note.";

  return (
    <div className="grid gap-2">
      {chain === "solana" ? (
        <div className="flex justify-start [&_.wallet-adapter-button]:rounded-xl [&_.wallet-adapter-button]:bg-brand-linen/15 [&_.wallet-adapter-button]:text-brand-linen [&_.wallet-adapter-button]:ring-1 [&_.wallet-adapter-button]:ring-brand-linen/25 [&_.wallet-adapter-button]:backdrop-blur-xl [&_.wallet-adapter-button:hover]:bg-brand-linen/20">
          <WalletMultiButton />
        </div>
      ) : null}

      <form className="grid gap-2" onSubmit={onSubmit}>
        <label
          className="text-sm font-semibold text-brand-linen"
          htmlFor="cctp-amount"
        >
          {chain === "solana"
            ? "USDC (from Solana devnet)"
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
          <Button className="min-h-11" type="submit" disabled={busy}>
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
          message={errors.amount?.message}
          variant="error"
          toastId="cctp-amount-error"
        />
        <ToastFeedback
          message={status?.msg}
          variant={status?.kind === "ok" ? "success" : "error"}
          toastId="cctp-payment-status"
          action={
            status?.kind === "err" && canRetry
              ? { label: "Try again", onClick: () => void retry() }
              : undefined
          }
        />
      </form>
    </div>
  );
}
