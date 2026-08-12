"use client";

import {
  ArrowLeft,
  Banknote,
  Check,
  Copy,
  ExternalLink,
  Loader,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AnchorInfo,
  authenticate,
  isTrustedCommitResult,
  pollSep24Until,
  type Sep24Transaction,
  startInteractiveDeposit,
  validateAnchorPreflight,
} from "../../lib/anchor";
import {
  createBridge,
  persistRampSession,
  provisionBridge,
  updateRampSession,
} from "../../lib/bridge";
import { toBaseUnits } from "../../lib/crypto";
import { Button } from "../ui/button";
import { glassInsetClass } from "../ui/glass";
import { Input } from "../ui/input";

type State = "amount" | "preparing" | "interactive" | "ready";

export function MoneyGramDepositContent({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<State>("amount");
  const [amount, setAmount] = useState("15");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{
    info: AnchorInfo;
    id: string;
    url: string;
  } | null>(null);
  const [transaction, setTransaction] = useState<Sep24Transaction | null>(null);
  const [copied, setCopied] = useState(false);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    if (!session) return;
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedCommitResult(event, session.info, session.id)) return;
      const tx = event.data.payload.transaction;
      setTransaction(tx);
      updateRampSession(session.id, {
        status: tx.status,
        moreInfoUrl: tx.more_info_url,
      });
      setState("ready");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session]);

  async function start() {
    setError(null);
    let amountUnits: bigint;
    try {
      amountUnits = toBaseUnits(amount);
      if (amountUnits <= 0n) throw new Error();
    } catch {
      setError("Enter a valid USDC amount.");
      return;
    }
    popup.current = window.open("", "_blank");
    setState("preparing");
    try {
      const { info } = await validateAnchorPreflight({ requireDeposit: true });
      const bridge = createBridge();
      // Funding precedes the trustline inside provisionBridge; both complete
      // before authentication or MoneyGram launch.
      await provisionBridge(bridge);
      const token = await authenticate(info, bridge.keypair);
      const interactive = await startInteractiveDeposit(
        info,
        token,
        bridge.publicKey,
        amount,
      );
      persistRampSession(bridge, {
        mgiId: interactive.id,
        kind: "cash-in",
        amount: amountUnits,
        status: "incomplete",
      });
      setSession({ info, ...interactive });
      setState("interactive");
      if (popup.current && !popup.current.closed)
        popup.current.location.href = interactive.url;

      const staged = await pollSep24Until(
        info,
        token,
        interactive.id,
        (tx) =>
          tx.status === "pending_user_transfer_start" ||
          tx.status === "completed" ||
          tx.status === "refunded",
      );
      setTransaction(staged);
      updateRampSession(interactive.id, {
        status: staged.status,
        externalTransactionId: staged.external_transaction_id,
        moreInfoUrl: staged.more_info_url,
        stellarHash: staged.stellar_transaction_id,
      });
      setState("ready");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not stage the MoneyGram deposit.",
      );
      setState("amount");
    }
  }

  if (state === "amount") {
    return (
      <div className="grid gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1 text-sm text-brand-linen/65"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className={`${glassInsetClass} p-3 text-sm text-brand-linen/70`}>
          Stage a sandbox cash deposit at a documented MoneyGram test location.
          Funds are not automatically shielded.
        </div>
        <label
          htmlFor="moneygram-deposit-amount"
          className="text-sm text-brand-linen/70"
        >
          Amount (USDC)
        </label>
        <Input
          id="moneygram-deposit-amount"
          appearance="glass"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        ) : null}
        <Button variant="glass" size="lg" onClick={start}>
          <Banknote className="size-4" /> Continue to MoneyGram
        </Button>
      </div>
    );
  }

  if (state === "preparing") {
    return (
      <div className="flex items-center justify-center gap-3 py-8 text-sm text-brand-linen/70">
        <Loader className="size-5 motion-safe:animate-spin" /> Preparing a
        disposable Stellar account…
      </div>
    );
  }

  if (state === "interactive" && session) {
    return (
      <div className="grid gap-3 text-sm text-brand-linen/70">
        <p>
          Select a sandbox location and commit the deposit in MoneyGram’s secure
          window.
        </p>
        <Button
          variant="glass"
          nativeButton={false}
          render={
            <a href={session.url} target="_blank" rel="noopener noreferrer" />
          }
        >
          <ExternalLink className="size-4" /> Reopen MoneyGram
        </Button>
        <div className="flex items-center justify-center gap-2">
          <Loader className="size-4 motion-safe:animate-spin" /> Waiting for
          commit…
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 text-sm text-brand-linen/70">
      <h3 className="font-heading text-lg font-semibold text-brand-linen">
        Cash-in evidence ready
      </h3>
      <p>
        The deposit is staged. Do not wait for store settlement for
        certification.
      </p>
      {session ? (
        <Button
          variant="glass"
          onClick={async () => {
            await navigator.clipboard?.writeText(session.id);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{" "}
          MGI transaction ID: {session.id}
        </Button>
      ) : null}
      {transaction?.more_info_url ? (
        <Button
          variant="ghost"
          nativeButton={false}
          render={
            <a
              href={transaction.more_info_url}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          Open transaction status
        </Button>
      ) : null}
    </div>
  );
}
