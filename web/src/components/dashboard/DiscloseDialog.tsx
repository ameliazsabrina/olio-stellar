"use client";

import { Download, Loader } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import {
  buildDisclosure,
  type DisclosureBundle,
  verifyDisclosure,
} from "../../lib/disclosure";
import { downloadDisclosurePdf } from "../../lib/disclosurePdf";
import { getAccount, scanMyNotes } from "../../lib/notes";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenInsetClass } from "../ui/glass";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";

type Step = "building" | "ready" | "error";

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
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <DialogTitle>Create payment receipt</DialogTitle>
          <DialogDescription>
            Build a verifiable receipt for this private payment.
          </DialogDescription>
        </DialogHeader>

        {step === "building" && (
          <div className="flex items-center justify-center gap-2 py-8 text-center">
            <Loader
              className="size-4 text-foreground/70 motion-safe:animate-spin"
              aria-hidden="true"
            />
            <div className="text-sm font-medium text-foreground">
              Preparing your receipt…
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="grid gap-4">
            <ToastFeedback
              message={error}
              variant="error"
              toastId="disclosure-error"
              action={{ label: "Try again", onClick: () => void build() }}
            />
            <Button variant="default" className="min-h-11" onClick={build}>
              Try again
            </Button>
          </div>
        )}

        {step === "ready" && bundle && (
          <div className="grid gap-4">
            <div className={cn(linenInsetClass, "rounded-2xl p-4")}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-foreground/65">
                  Payment received
                </span>
                <span className="font-heading text-2xl font-semibold text-foreground">
                  {fromBaseUnits(BigInt(bundle.amount))} USDC
                </span>
              </div>
              <dl className="mt-3 grid gap-1.5 border-t border-foreground/15 pt-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-foreground/65">Recipient</dt>
                  <dd className="font-medium text-foreground">
                    {bundle.username ? `@${bundle.username}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-foreground/65">Payment reference</dt>
                  <dd className="font-mono text-foreground">
                    #{bundle.leafIndex}
                  </dd>
                </div>
              </dl>
            </div>

            <Button
              variant="default"
              className="min-h-11 mt-4"
              size="lg"
              onClick={() => void downloadDisclosurePdf(bundle)}
            >
              <Download className="size-4" aria-hidden="true" />
              Download receipt (PDF)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
