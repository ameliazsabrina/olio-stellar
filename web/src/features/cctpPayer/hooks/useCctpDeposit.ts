"use client";

import type { Connection } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CCTP_CHAIN_DOMAIN, cctpIntakeContract } from "../../../lib/cctp";
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
  | { chain: "evm" | "base" }
  | { chain: "solana"; wallet: SolanaBurnWallet; connection: Connection };
export type CctpPhase = "idle" | "burning" | "attesting" | "relaying" | "done";
export type CctpStatus = { kind: "ok" | "err"; msg: string } | null;
export type CctpFeePreview = {
  paymentAmount: string;
  feeBps: 200 | 500;
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
}: {
  username: string;
  notePubkey: Uint8Array;
}) {
  const [phase, setPhase] = useState<CctpPhase>("idle");
  const [status, setStatus] = useState<CctpStatus>(null);
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
          msg: "Payment recovery storage is unavailable. Restore your recovery file before starting another payment.",
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
                msg: `Paid ${current.result?.paymentAmount} USDC to @${username}.`,
              });
            }
            failures = 0;
          } catch {
            failures++;
            if (!cancelled)
              setStatus({
                kind: "err",
                msg: "Payment tracking is temporarily unavailable. Your recovery is saved.",
              });
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
          throw new Error("Cross-chain deposits aren't configured.");
        if (!/^\d+(\.\d{1,6})?$/.test(amount))
          throw new Error(
            "Cross-chain payments support at most 6 decimal places.",
          );
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
            "The recipient's fee changed. Review the updated total before paying.",
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
              msg: "Payment saved on Olio. Export recovery now because browser storage is unavailable.",
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
          msg: "Payment submitted. Olio is completing it automatically — you can close this page.",
        });
      } catch (error) {
        // A burned payment is durable and tracked automatically; an unburned intent is discarded so it never blocks a retry.
        if (burned)
          setStatus({
            kind: "err",
            msg: "Payment submitted. Olio is completing it automatically.",
          });
        else {
          if (recovery) forget(recovery);
          setStatus({
            kind: "err",
            msg:
              error instanceof Error
                ? error.message
                : "Cross-chain payment unavailable.",
          });
        }
      } finally {
        active.current = false;
        setPhase("idle");
        setPollRevision((v) => v + 1);
      }
    },
    [notePubkey, username, persist, forget],
  );

  const restore = useCallback(
    async (text: string) => {
      if (text.length > 100_000) throw new Error("Recovery file is too large.");
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
          throw new Error(
            "Recovery belongs to a different recipient or deployment.",
          );
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
  const hasPendingPayment = records.some(
    (r) => r.status?.stage !== "completed" && isSubmitted(r),
  );
  return {
    phase,
    status,
    start,
    hasPendingPayment,
    payments: records,
    exportRecovery: () => exportRecovery(records),
    restore,
  };
}
