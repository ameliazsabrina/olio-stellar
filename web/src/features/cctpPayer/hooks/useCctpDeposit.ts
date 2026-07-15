"use client";

import type { Connection } from "@solana/web3.js";
import { useCallback, useState } from "react";
import { cctpIntakeContract } from "../../../lib/cctp";
import { api } from "../../../trpc/client";
import { burnToStellar } from "../burn";
import { burnFromSolana, type SolanaBurnWallet } from "../burnSolana";

export type CctpChain = "evm" | "solana";

// Solana burns pass in the context-scoped wallet + connection to keep the hook adapter-free.
export type CctpStartOpts =
  | { chain: "evm" }
  | { chain: "solana"; wallet: SolanaBurnWallet; connection: Connection };

export type CctpPhase = "idle" | "burning" | "attesting" | "relaying" | "done";
export type CctpStatus = { kind: "ok" | "err"; msg: string } | null;

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

export function useCctpDeposit({
  username,
  notePubkey,
}: {
  username: string;
  notePubkey: Uint8Array;
}) {
  const [phase, setPhase] = useState<CctpPhase>("idle");
  const [status, setStatus] = useState<CctpStatus>(null);

  const start = useCallback(
    async (amount: string, opts: CctpStartOpts = { chain: "evm" }) => {
      setStatus(null);
      if (!cctpIntakeContract) {
        setStatus({
          kind: "err",
          msg: "Cross-chain deposits aren't configured.",
        });
        return;
      }
      try {
        setPhase("burning");
        // Both burns return the same shape; everything downstream is chain-agnostic.
        const { txHash, sourceDomain, nonce } =
          opts.chain === "solana"
            ? await burnFromSolana({
                intakeContract: cctpIntakeContract,
                payeeNotePubkey: notePubkey,
                amount,
                wallet: opts.wallet,
                connection: opts.connection,
              })
            : await burnToStellar({
                intakeContract: cctpIntakeContract,
                payeeNotePubkey: notePubkey,
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
          nonce,
        });

        setPhase("done");
        setStatus({
          kind: "ok",
          msg: `Sent ${res.amount} USDC to @${username}. See the proof here.`,
        });
      } catch (e) {
        setPhase("idle");
        setStatus({
          kind: "err",
          msg: e instanceof Error ? e.message : "Cross-chain payment failed.",
        });
      }
    },
    [username, notePubkey],
  );

  return { phase, status, start };
}
