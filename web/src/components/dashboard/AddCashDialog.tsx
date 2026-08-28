"use client";

import { lazy, Suspense } from "react";
import { moneyGramRampStatus } from "../../lib/moneygram-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const MoneyGramDepositContent = lazy(() =>
  import("./MoneyGramDepositContent").then((module) => ({
    default: module.MoneyGramDepositContent,
  })),
);

export function AddCashDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <DialogTitle>Add cash</DialogTitle>
          <DialogDescription>
            MoneyGram{" "}
            {moneyGramRampStatus === "sandbox" ? "sandbox" : "cash-in"} through
            your recoverable Privy Stellar account.
          </DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <div className="py-8 text-center text-sm text-foreground/65">
              Loading MoneyGram…
            </div>
          }
        >
          <MoneyGramDepositContent onComplete={onComplete} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
