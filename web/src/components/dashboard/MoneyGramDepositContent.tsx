"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Loader,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AnchorInfo,
  authenticate,
  ensureUsdcTrustline,
  friendbotUrl,
  isTrustedCommitResult,
  listSep24Transactions,
  pollSep24Until,
  Sep24PollTimeoutError,
  type Sep24Transaction,
  startInteractiveDeposit,
  validateAnchorPreflight,
  verifyInboundUsdcPayment,
} from "../../lib/anchor";
import {
  listRampSessions,
  persistCashInSession,
  updateRampSession,
} from "../../lib/bridge";
import { toBaseUnits } from "../../lib/crypto";
import { shieldVerifiedCashIn } from "../../lib/moneygram-cash-in";
import { moneyGramRampStatus } from "../../lib/moneygram-status";
import { getAccount } from "../../lib/notes";
import { explorerTxUrl, isMainnet } from "../../lib/stellar";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import { linenInsetClass } from "../ui/glass";
import { Input } from "../ui/input";
import { useWallet } from "../WalletProvider";

type State =
  | "amount"
  | "preparing"
  | "interactive"
  | "shielding"
  | "recoverable"
  | "done";
type Session = { info: AnchorInfo; token: string; id: string; url: string };
const TERMINAL = new Set(["completed", "refunded", "expired", "error"]);
const MIN_DEPOSIT_UNITS = toBaseUnits("15");

export function MoneyGramDepositContent({
  onComplete,
}: {
  onComplete?: () => void | Promise<void>;
}) {
  const wallet = useWallet();
  const [state, setState] = useState<State>("amount");
  const [amount, setAmount] = useState("15");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [transaction, setTransaction] = useState<Sep24Transaction | null>(null);
  const [shieldingHash, setShieldingHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    if (!session) return;
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedCommitResult(event, session.url, session.id)) return;
      setNotice("MoneyGram submitted the hosted flow. Confirming status…");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session]);

  useEffect(() => {
    if (state !== "interactive") return;
    const timer = window.setInterval(() => {
      if (popup.current?.closed) {
        setNotice(
          "The MoneyGram window was closed. Status checks continue here, or you can reopen it.",
        );
        window.clearInterval(timer);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  async function shield(tx: Sep24Transaction, current: Session) {
    setState("shielding");
    setError(null);
    try {
      const account = getAccount();
      if (!account || !wallet.accountUnlocked)
        throw new Error(
          "Unlock your Olio wallet before shielding this cash-in.",
        );
      const payment = await verifyInboundUsdcPayment(wallet.privyPublicKey, tx);
      updateRampSession(current.id, {
        status: tx.status,
        stellarHash: payment.transactionHash,
        operationId: payment.operationId,
        externalTransactionId: tx.external_transaction_id,
        moreInfoUrl: tx.more_info_url,
      });
      const result = await shieldVerifiedCashIn({
        account,
        olioSigner: wallet.getSigner(),
        privyUsdcSigner: wallet.getPrivyUsdcSigner(),
        settlementIdentity: `${payment.transactionHash}:${payment.operationId}`,
        amount: payment.amount,
      });
      setShieldingHash(result.shieldingTransactionHash);
      updateRampSession(current.id, {
        status: "shielded",
        shieldingHash: result.shieldingTransactionHash ?? undefined,
        transferHash: result.transferTransactionHash ?? undefined,
      });
      setTransaction(tx);
      setState("done");
      await onComplete?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} The USDC remains recoverable in your Privy/Olio account; retry shielding when ready.`
          : "Shielding failed. The USDC remains recoverable in your account.",
      );
      setTransaction(tx);
      setState("recoverable");
    }
  }

  async function waitForSettlement(current: Session) {
    try {
      const settled = await pollSep24Until(
        current.info,
        current.token,
        current.id,
        (tx) => tx.status === "completed" || tx.status === "refunded",
        { timeoutMs: 30 * 60_000 },
      );
      setTransaction(settled);
      updateRampSession(current.id, {
        status: settled.status,
        externalTransactionId: settled.external_transaction_id,
        moreInfoUrl: settled.more_info_url,
        stellarHash: settled.stellar_transaction_id,
      });
      if (settled.status === "refunded")
        throw new Error(
          "MoneyGram refunded this cash-in; no funds were shielded.",
        );
      await shield(settled, current);
    } catch (cause) {
      if (cause instanceof Sep24PollTimeoutError) {
        setTransaction(cause.lastTransaction);
        setError(
          "MoneyGram is still processing this cash-in. You can safely close this dialog and check again later.",
        );
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : "Cash-in status check failed.",
        );
      }
      setState("recoverable");
    }
  }

  async function start() {
    setError(null);
    setNotice(null);
    if (!wallet.authenticated || !wallet.privyPublicKey) {
      setError("Sign in with Privy before adding cash.");
      return;
    }
    if (!wallet.accountUnlocked) {
      wallet.promptUnlock();
      setError("Unlock your wallet, then continue the cash-in.");
      return;
    }
    let units: bigint;
    try {
      units = toBaseUnits(amount);
      if (units <= 0n) throw new Error();
    } catch {
      setError("Enter a valid USDC amount.");
      return;
    }
    if (units < MIN_DEPOSIT_UNITS) {
      setError("MoneyGram deposits require a minimum of 15 USDC.");
      return;
    }
    setState("preparing");
    try {
      const { info } = await validateAnchorPreflight({ requireDeposit: true });
      if (isMainnet) {
        await api.bridge.fundWallet.mutate({
          bridgePublicKey: wallet.privyPublicKey,
        });
      } else {
        const funding = await fetch(
          `${friendbotUrl}?addr=${encodeURIComponent(wallet.privyPublicKey)}`,
        );
        if (!funding.ok && funding.status !== 400) {
          throw new Error(
            `Could not fund the Privy testnet account (${funding.status}).`,
          );
        }
      }
      await ensureUsdcTrustline(
        wallet.privyPublicKey,
        wallet.signPrivyTransaction,
      );
      const token = await authenticate(info, wallet.getPrivySep10Signer());
      const history = await listSep24Transactions(
        info,
        token,
        wallet.privyPublicKey,
      ).catch(() => []);
      const locallyShielded = new Set(
        listRampSessions()
          .filter((row) => row.kind === "cash-in" && row.status === "shielded")
          .map((row) => row.mgiId),
      );
      const recovering = history.find(
        (tx) =>
          tx.kind === "deposit" &&
          !locallyShielded.has(tx.id) &&
          (tx.status === "completed" || !TERMINAL.has(tx.status)),
      );
      if (recovering) {
        const recovered: Session = {
          info,
          token,
          id: recovering.id,
          url: recovering.more_info_url ?? "",
        };
        persistCashInSession({
          mgiId: recovering.id,
          publicKey: wallet.privyPublicKey,
          amount: toBaseUnits(
            recovering.amount_out ?? recovering.amount_in ?? amount,
          ),
          status: recovering.status,
        });
        setSession(recovered);
        setTransaction(recovering);
        setNotice(
          "Recovered your existing MoneyGram cash-in from authenticated SEP-24 history.",
        );
        if (recovering.status === "completed")
          await shield(recovering, recovered);
        else {
          setState("interactive");
          await waitForSettlement(recovered);
        }
        return;
      }
      const interactive = await startInteractiveDeposit(
        info,
        token,
        wallet.privyPublicKey,
        amount,
      );
      persistCashInSession({
        mgiId: interactive.id,
        publicKey: wallet.privyPublicKey,
        amount: units,
      });
      const current = { info, token, ...interactive };
      setSession(current);
      setState("interactive");
      // Do not pre-open an about:blank tab while the account, trustline, and
      // SEP-24 session are prepared. Open the real hosted URL directly once it
      // exists. Async preparation can exhaust Chrome's popup gesture window,
      // so fall back to a same-tab navigation rather than leaving the user on
      // a blank or blocked popup.
      popup.current = window.open(interactive.url, "_blank");
      if (!popup.current) {
        window.location.assign(interactive.url);
        return;
      }
      await waitForSettlement(current);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start MoneyGram cash-in.",
      );
      setState("amount");
    }
  }

  async function refreshStatus() {
    if (!session) return;
    setState("interactive");
    setError(null);
    await waitForSettlement(session);
  }

  if (state === "amount")
    return (
      <div className="grid gap-3">
        <label
          htmlFor="moneygram-deposit-amount"
          className="text-sm text-foreground/70"
        >
          Amount (USDC)
        </label>
        <Input
          id="moneygram-deposit-amount"
          appearance="linen"
          type="number"
          inputMode="decimal"
          min="15"
          step="0.0000001"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={error ? true : undefined}
        />
        {error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
        <Button variant="default" size="lg" onClick={start}>
          Continue to MoneyGram
        </Button>
      </div>
    );

  if (state === "preparing")
    return (
      <div className="grid justify-items-center gap-3 py-8 text-center text-sm text-foreground/70">
        <Loader className="size-5 motion-safe:animate-spin" />
        Preparing your recoverable Stellar account and USDC trustline…
        {notice ? <p>{notice}</p> : null}
      </div>
    );

  if ((state === "interactive" || state === "recoverable") && session)
    return (
      <div className="grid gap-3 text-sm text-foreground/70">
        {state === "interactive" ? (
          <div className="flex items-center justify-center gap-2">
            <Loader className="size-4 motion-safe:animate-spin" /> Waiting for
            MoneyGram settlement…
          </div>
        ) : null}
        {notice ? <p>{notice}</p> : null}
        {error ? (
          <p role="alert" className="flex gap-2 text-red-600">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : null}
        {session.url ? (
          <>
            <Button
              variant="default"
              onClick={() => {
                popup.current = window.open(
                  session.url,
                  "_blank",
                  "noopener,noreferrer",
                );
                if (!popup.current)
                  setNotice("Popup blocked. Use Continue in this tab.");
              }}
            >
              <ExternalLink className="size-4" /> Reopen MoneyGram
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.location.assign(session.url)}
            >
              Continue in this tab
            </Button>
          </>
        ) : null}
        {state === "recoverable" ? (
          <Button variant="secondary" onClick={refreshStatus}>
            Check status and retry shielding
          </Button>
        ) : null}
        {transaction?.more_info_url ? (
          <a
            href={transaction.more_info_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open MoneyGram status
          </a>
        ) : null}
      </div>
    );

  if (state === "shielding")
    return (
      <div className="grid justify-items-center gap-3 py-8 text-center text-sm text-foreground/70">
        <Loader className="size-5 motion-safe:animate-spin" /> Payment verified.
        Shielding the exact received amount…
      </div>
    );

  return (
    <div className="grid gap-3 text-sm text-foreground/70">
      <div className="flex items-center gap-2 text-emerald-700">
        <ShieldCheck className="size-5" /> Cash-in shielded
      </div>
      <p>
        {transaction?.amount_out
          ? `${transaction.amount_out} USDC was added to your private balance.`
          : "Verified USDC was added to your private balance."}
      </p>
      {session ? (
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(session.id);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{" "}
          MoneyGram ID: {session.id}
        </Button>
      ) : null}
      {transaction?.stellar_transaction_id ? (
        <a
          href={explorerTxUrl(transaction.stellar_transaction_id)}
          target="_blank"
          rel="noreferrer"
        >
          MoneyGram Stellar transaction
        </a>
      ) : null}
      {shieldingHash ? (
        <a href={explorerTxUrl(shieldingHash)} target="_blank" rel="noreferrer">
          Olio shielding transaction
        </a>
      ) : null}
    </div>
  );
}
