"use client";

import { Download, FileCheck, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import {
  buildDisclosure,
  type DisclosureBundle,
  verifyDisclosure,
} from "../../lib/disclosure";
import { downloadDisclosurePdf } from "../../lib/disclosurePdf";
import { getAccount, scanMyNotes } from "../../lib/notes";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { useWallet } from "../WalletProvider";

type Step = "building" | "ready" | "error";

function truncMiddle(s: string, keep = 8): string {
  return s.length > keep * 2 + 1 ? `${s.slice(0, keep)}…${s.slice(-keep)}` : s;
}

export function DiscloseDialog({
  open,
  onClose,
  leafIndex,
}: {
  open: boolean;
  onClose: () => void;
  leafIndex: number | null;
}) {
  const { username } = useWallet();
  const [step, setStep] = useState<Step>("building");
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<DisclosureBundle | null>(null);

  const build = useCallback(async () => {
    if (leafIndex === null) return;
    setStep("building");
    setError(null);
    setBundle(null);
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const scan = await scanMyNotes(acct);
      const note = scan.notes.find((n) => n.leafIndex === leafIndex);
      if (!note) throw new Error("That payment is no longer available.");
      const disclosure = await buildDisclosure({
        acct,
        scan,
        note,
        username,
      });
      // Sanity-check the envelope round-trips before we let it out the door.
      const check = await verifyDisclosure(disclosure);
      if (!check.valid) {
        throw new Error("Could not build a consistent proof for this payment.");
      }
      setBundle(disclosure);
      setStep("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build proof.");
      setStep("error");
    }
  }, [leafIndex, username]);

  useEffect(() => {
    if (open && leafIndex !== null) void build();
  }, [open, leafIndex, build]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="flex items-center gap-2">
          <FileCheck className="size-4 text-olive" />
          Prove this payment
        </DialogTitle>

        {step === "building" && (
          <div className="grid place-items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-olive" />
            <div className="text-sm font-medium text-ink">
              Building your disclosure…
            </div>
            <div className="text-xs text-muted-text">
              Assembling the commitment opening and Merkle proof for this single
              payment.
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="grid gap-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="secondary" className="min-h-11" onClick={build}>
              Try again
            </Button>
          </div>
        )}

        {step === "ready" && bundle && (
          <div className="grid gap-4">
            <div className="rounded-lg border border-line bg-white/60 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-text">
                  Payment received
                </span>
                <span className="font-heading text-2xl font-semibold text-ink">
                  {fromBaseUnits(BigInt(bundle.amount))} USDC
                </span>
              </div>
              <dl className="mt-3 grid gap-1.5 border-t border-line pt-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-text">Recipient</dt>
                  <dd className="font-medium text-ink">
                    {bundle.username ? `@${bundle.username}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-text">Note</dt>
                  <dd className="font-mono text-ink">#{bundle.leafIndex}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-text">Commitment</dt>
                  <dd className="font-mono text-ink">
                    {truncMiddle(bundle.commitmentHex)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-text">Merkle root</dt>
                  <dd className="font-mono text-ink">
                    {truncMiddle(bundle.rootHex)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-sage/50 px-3 py-2.5 text-xs text-olive-deep">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-olive" />
              <span>
                The PDF proves this one payment only. It opens this note's
                commitment and reveals nothing about your other payments.
              </span>
            </div>

            <Button
              className="min-h-11"
              size="lg"
              onClick={() => void downloadDisclosurePdf(bundle)}
            >
              <Download className="size-4" />
              Download proof (PDF)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
