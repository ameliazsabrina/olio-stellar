"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { burnToStellar } from "../../../features/cctpPayer/burn";
import { cctpIntakeAddress } from "../../../lib/cctp";
import { api } from "../../../trpc/client";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Enter an amount greater than zero."),
});
type PayInput = z.infer<typeof payInput>;

type Phase = "idle" | "burning" | "attesting" | "relaying" | "done";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForAttestation(sourceDomain: number, txHash: string) {
  // Finalized CCTP transfers can take a few minutes; poll patiently.
  for (let i = 0; i < 120; i += 1) {
    const res = await api.cctp.attestation.query({ sourceDomain, txHash });
    if (res.status === "complete" && res.message && res.attestation) {
      return { message: res.message, attestation: res.attestation };
    }
    await sleep(5000);
  }
  throw new Error(
    "Timed out waiting for Circle's attestation. Try relaying again later.",
  );
}

export function CctpPayForm({ username }: { username: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: "" },
  });

  const busy = phase !== "idle" && phase !== "done";

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    if (!cctpIntakeAddress) {
      setStatus({
        kind: "err",
        msg: "Cross-chain deposits aren't configured.",
      });
      return;
    }
    try {
      setPhase("burning");
      const { txHash, sourceDomain } = await burnToStellar({
        intakeAddress: cctpIntakeAddress,
        amount,
      });

      setPhase("attesting");
      const { message, attestation } = await waitForAttestation(
        sourceDomain,
        txHash,
      );

      setPhase("relaying");
      const res = await api.cctp.relay.mutate({
        username,
        message,
        attestation,
      });

      setPhase("done");
      setStatus({
        kind: "ok",
        msg: `Bridged ${res.amount} USDC to @${username}. Private note #${res.leafIndex} delivered.`,
      });
    } catch (e) {
      setPhase("idle");
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Cross-chain payment failed.",
      });
    }
  });

  const phaseLabel =
    phase === "burning"
      ? "Confirm the burn in your wallet…"
      : phase === "attesting"
        ? "Waiting for Circle's attestation…"
        : phase === "relaying"
          ? "Minting on Stellar & delivering the note…"
          : "Pay from another chain";

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
      <label htmlFor="cctp-amount">USDC (from an EVM chain)</label>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="cctp-amount"
          className="min-h-11 flex-1"
          inputMode="decimal"
          placeholder="5.00"
          disabled={busy}
          {...register("amount")}
        />
        <Button className="min-h-11" type="submit" disabled={busy}>
          {busy ? "Working…" : "Pay via CCTP"}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        {busy
          ? phaseLabel
          : "Burn USDC on Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or Avalanche Fuji — it arrives as a private note."}
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
  );
}
