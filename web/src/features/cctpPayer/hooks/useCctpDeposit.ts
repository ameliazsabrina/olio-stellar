"use client";

import type { Connection } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  CCTP_CHAIN_DOMAIN,
  type CctpChain,
  cctpIntakeContract,
} from "../../../lib/cctp";
import {
  bytesToHex,
  commitment,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32,
} from "../../../lib/crypto";
import { deserializeFeeQuoteEnvelope } from "../../../lib/fee-quote";
import { createSessionInput } from "../../../server/modules/cctp/cctp.schema";
import { api } from "../../../trpc/client";
import { burnToStellar, evmCctpIdentity } from "../burn";
import { burnFromSolana, type SolanaBurnWallet } from "../burnSolana";
import {
  exportRecovery,
  loadRecoveries,
  newCapability,
  type RecoveryRecord,
  recoveryRecordSchema,
  removeRecovery,
  saveRecovery,
} from "../recovery";

export type { CctpChain } from "../../../lib/cctp";
export type CctpStartOpts =
  | { chain: Exclude<CctpChain, "solana"> }
  | { chain: "solana"; wallet: SolanaBurnWallet; connection: Connection };
export type CctpPhase = "idle" | "burning" | "attesting" | "relaying" | "done";
export type CctpStatus = { kind: "ok" | "info" | "err"; msg: string } | null;
export type CctpFeePreview = {
  paymentAmount: string;
  feeBps: 200;
  feeAmount: string;
  totalAmount: string;
  policyVersion: 2;
};

// A record protects real funds only once a burn is broadcast; anything else is a discardable intent.
const isSubmitted = (record: RecoveryRecord) =>
  Boolean(record.sourceTxHash || record.input.legacySourceTxHash);

export function useCctpDeposit({
  username,
  notePubkey,
  invoice = null,
}: {
  username: string;
  notePubkey: Uint8Array;
  invoice?: { invoiceId: string; version: number } | null;
}) {
  const [phase, setPhase] = useState<CctpPhase>("idle");
  const [status, setStatus] = useState<CctpStatus>(null);
  // Kept apart from `status` so a transient poll failure never replaces a payment result.
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [records, setRecords] = useState<RecoveryRecord[]>([]);
  const [pollRevision, setPollRevision] = useState(0);
  const active = useRef(false);
  const resumed = useRef<Set<string>>(new Set());
  const recordRef = useRef(records);
  recordRef.current = records;
  const persist = useCallback((record: RecoveryRecord) => {
    // Retain the in-memory recovery even when storage starts failing after broadcast.
    setRecords((previous) => [
      ...previous.filter(
        (r) =>
          r.input.feeQuote.quote.quoteId !==
          record.input.feeQuote.quote.quoteId,
      ),
      record,
    ]);
    saveRecovery(record);
  }, []);
  const forget = useCallback((record: RecoveryRecord) => {
    setRecords((previous) =>
      previous.filter(
        (r) =>
          r.input.feeQuote.quote.quoteId !==
          record.input.feeQuote.quote.quoteId,
      ),
    );
    removeRecovery(record);
  }, []);

  useEffect(() => {
    const load = () => {
      try {
        const pending = loadRecoveries(username);
        // Migrate the previous username-only record after validating it. Remove only after durable session acceptance.
        const legacy = window.localStorage.getItem(
          `olio:cctp-relay:${username}`,
        );
        if (legacy) {
          const value = JSON.parse(legacy);
          if (
            !pending.some(
              (r) =>
                r.input.feeQuote.quote.quoteId ===
                value.feeQuote?.quote?.quoteId,
            )
          ) {
            const input = createSessionInput.parse({
              username,
              salt: value.salt,
              feeQuote: value.feeQuote,
              legacySourceTxHash: value.txHash,
              capability: newCapability(),
            });
            const record: RecoveryRecord = {
              version: 1,
              input,
              sourceTxHash: value.txHash,
            };
            saveRecovery(record);
            pending.push(record);
          }
        }
        setRecords(pending);
      } catch {
        setStatus({
          kind: "err",
          msg: "We couldn't load your saved payments. Restore your payment backup before paying again.",
        });
      }
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, [username]);

  // Status polling never drives settlement. Closing this page leaves the server worker running.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pollRevision restarts polling after payment submission or recovery restoration.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      if (!document.hidden && !active.current) {
        // Only reconcile in-flight payments; a bare pre-burn intent carries no funds to track.
        for (const original of recordRef.current.filter(
          (r) =>
            r.status?.stage !== "completed" && (r.sessionId || isSubmitted(r)),
        )) {
          if (cancelled) return;
          try {
            let record = { ...original };
            if (!record.sessionId) {
              const created = await api.cctp.createSession.mutate(record.input);
              record = {
                ...record,
                sessionId: created.sessionId,
                status: created,
              };
              if (cancelled) return;
              persist(record);
              if (record.input.legacySourceTxHash)
                window.localStorage.removeItem(`olio:cctp-relay:${username}`);
            }
            const auth = {
              sessionId: record.sessionId!,
              capability: record.input.capability,
            };
            if (record.sourceTxHash)
              await api.cctp.recordSubmission.mutate({
                ...auth,
                sourceTxHash: record.sourceTxHash,
                solanaBlockhash: record.solanaBlockhash,
                solanaLastValidBlockHeight: record.solanaLastValidBlockHeight,
              });
            // Resume settlement automatically the first time we see a session; afterwards just read status.
            const current = resumed.current.has(record.sessionId!)
              ? await api.cctp.sessionStatus.mutate(auth)
              : await api.cctp.resumeSession.mutate(auth);
            resumed.current.add(record.sessionId!);
            if (cancelled) return;
            persist({ ...record, status: current });
            if (current.stage === "completed") {
              setPhase("done");
              setStatus({
                kind: "ok",
                msg: `${current.result?.paymentAmount ? `Paid ${current.result.paymentAmount} USDC to @${username}.` : `Payment to @${username} completed.`} It can take a while for @${username} to receive it.`,
              });
            }
            failures = 0;
            setTrackingError(null);
          } catch {
            failures++;
            if (!cancelled)
              setTrackingError(
                "We can't check your payment status right now. We'll keep trying.",
              );
          }
        }
      }
      if (!cancelled)
        timer = setTimeout(
          poll,
          document.hidden
            ? 60_000
            : Math.min(30_000, 5000 * 2 ** Math.min(failures, 3)),
        );
    };
    void poll();
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        timer = setTimeout(poll, 0);
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [persist, username, pollRevision]);

  const start = useCallback(
    async (
      amount: string,
      expectedFee: CctpFeePreview,
      opts: CctpStartOpts = { chain: "evm" },
    ) => {
      if (active.current) return;
      active.current = true;
      let recovery: RecoveryRecord | undefined;
      let burned = false;
      setStatus(null);
      setPhase("burning");
      try {
        if (!cctpIntakeContract)
          throw new Error(
            "Paying from other networks isn't available right now.",
          );
        if (!/^\d+(\.\d{1,6})?$/.test(amount))
          throw new Error("Use at most 6 decimal places.");
        const paymentAmount = toBaseUnits(amount);
        const salt = randomFieldElement();
        const saltHex = bytesToHex(toBE32(salt));
        const commitmentBytes = toBE32(
          await commitment(paymentAmount, fromBE(notePubkey), salt),
        );
        const identity =
          opts.chain === "solana"
            ? {
                sourceDomain: 5,
                sourcePayer: opts.wallet.publicKey
                  ? bytesToHex(opts.wallet.publicKey.toBytes())
                  : (() => {
                      throw new Error("Connect a Solana wallet to pay.");
                    })(),
              }
            : await evmCctpIdentity(CCTP_CHAIN_DOMAIN[opts.chain]);
        const serialized = await api.feeQuotes.issue.mutate({
          username,
          paymentAmount: paymentAmount.toString(),
          channel: "cctp",
          depositor: cctpIntakeContract,
          commitment: bytesToHex(commitmentBytes),
          salt: saltHex,
          ...identity,
          ...(invoice ? { invoice } : {}),
        });
        const feeQuote = deserializeFeeQuoteEnvelope(serialized);
        if (
          feeQuote.quote.paymentAmount.toString() !==
            expectedFee.paymentAmount ||
          feeQuote.quote.feeBps !== expectedFee.feeBps ||
          feeQuote.quote.feeAmount.toString() !== expectedFee.feeAmount ||
          feeQuote.quote.totalAmount.toString() !== expectedFee.totalAmount ||
          feeQuote.quote.policyVersion !== expectedFee.policyVersion
        )
          throw new Error(
            "The recipient’s fee changed. Review the updated total and pay again.",
          );
        recovery = {
          version: 1,
          input: {
            username,
            salt: saltHex,
            feeQuote: serialized,
            capability: newCapability(),
          },
        };
        persist(recovery); // Must succeed before any wallet burn prompt.
        const created = await api.cctp.createSession.mutate(recovery.input);
        recovery = {
          ...recovery,
          sessionId: created.sessionId,
          status: created,
        };
        persist(recovery);
        const auth = {
          sessionId: created.sessionId,
          capability: recovery.input.capability,
        };
        const beforeBurn = async () => {
          const current = await api.cctp.prepareBurn.mutate(auth);
          recovery = { ...recovery!, status: current };
          persist(recovery);
        };
        const onSubmitted = async (
          sourceTxHash: string,
          validity?: { blockhash: string; lastValidBlockHeight: number },
        ) => {
          burned = true;
          recovery = {
            ...recovery!,
            sourceTxHash,
            ...(validity
              ? {
                  solanaBlockhash: validity.blockhash,
                  solanaLastValidBlockHeight: validity.lastValidBlockHeight,
                }
              : {}),
          };
          // EVM has already broadcast. Always try the server even when browser storage fails.
          let saved = true;
          try {
            persist(recovery);
          } catch {
            saved = false;
          }
          await api.cctp.recordSubmission.mutate({
            ...auth,
            sourceTxHash,
            solanaBlockhash: recovery.solanaBlockhash,
            solanaLastValidBlockHeight: recovery.solanaLastValidBlockHeight,
          });
          if (!saved)
            setStatus({
              kind: "err",
              msg: "Your payment was sent, but this browser couldn't keep a copy. Save a payment backup now.",
            });
        };
        if (opts.chain === "solana")
          await burnFromSolana({
            intakeContract: cctpIntakeContract,
            feeQuote,
            wallet: opts.wallet,
            connection: opts.connection,
            beforeBurn,
            onSubmitted,
          });
        else
          await burnToStellar({
            intakeContract: cctpIntakeContract,
            feeQuote,
            beforeBurn,
            onSubmitted,
          });
        setStatus({
          kind: "ok",
          msg: `Payment sent. It can take a while for @${username} to receive it.`,
        });
      } catch (error) {
        // A burned payment is durable and tracked automatically; an unburned intent is discarded so it never blocks a retry.
        if (burned)
          setStatus({
            kind: "info",
            msg: "Your payment is processing. Please wait.",
          });
        else {
          if (recovery) forget(recovery);
          setStatus({
            kind: "err",
            msg:
              error instanceof Error
                ? error.message
                : "Payment didn't go through. Please try again.",
          });
        }
      } finally {
        active.current = false;
        setPhase("idle");
        setPollRevision((v) => v + 1);
      }
    },
    [notePubkey, username, persist, forget, invoice],
  );

  const restore = useCallback(
    async (text: string) => {
      if (text.length > 100_000)
        throw new Error("This backup file is too large.");
      const restored = z
        .array(recoveryRecordSchema)
        .min(1)
        .max(20)
        .parse(JSON.parse(text));
      for (const record of restored) {
        if (
          record.input.username !== username ||
          record.input.feeQuote.quote.depositor !== cctpIntakeContract
        )
          throw new Error("This backup file is for a different recipient.");
        if (record.sessionId)
          await api.cctp.sessionStatus.mutate({
            sessionId: record.sessionId,
            capability: record.input.capability,
          });
        persist(record);
      }
      setPollRevision((v) => v + 1);
    },
    [persist, username],
  );
  // needs_attention records get their own error toast, so they are not "being completed automatically".
  const hasPendingPayment = records.some(
    (r) =>
      r.status?.stage !== "completed" &&
      r.status?.stage !== "needs_attention" &&
      isSubmitted(r),
  );
  return {
    phase,
    status,
    trackingError,
    start,
    hasPendingPayment,
    payments: records,
    exportRecovery: () => exportRecovery(records),
    restore,
  };
}
