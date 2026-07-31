"use client";

import { Fingerprint, Loader, LogIn } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";

export function StellarWalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { address, connecting, error, createPasskey, connectPasskey } =
    useWallet();
  const connected = Boolean(address);
  const [pendingAction, setPendingAction] = useState<
    "create" | "connect" | null
  >(null);

  const runAction = async (
    action: "create" | "connect",
    callback: () => Promise<void>,
  ) => {
    setPendingAction(action);
    try {
      await callback();
    } finally {
      setPendingAction(null);
    }
  };

  useLayoutEffect(() => {
    if (open && connected) onClose();
  }, [open, connected, onClose]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent appearance="glass" className="max-w-[420px] gap-0">
        <DialogTitle className="text-lg font-semibold text-center">
          Create Your Account
        </DialogTitle>
        <p className="mx-auto mt-2 max-w-[32ch] text-center text-sm leading-4">
          A passkey secures your wallet with your device. No seed phrase, no
          gas.
        </p>

        <div className="mt-6 grid gap-3">
          <Button
            variant="glass"
            className="min-h-11 w-full gap-2.5"
            onClick={() => runAction("create", createPasskey)}
            disabled={connecting}
            aria-busy={connecting}
            type="button"
          >
            {pendingAction === "create" ? (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Fingerprint className="size-4" aria-hidden="true" />
            )}
            {pendingAction === "create" ? "Working…" : "Create a passkey"}
          </Button>
          <Button
            variant="glass"
            className="min-h-11 w-full gap-2.5 disabled:opacity-55"
            onClick={() => runAction("connect", connectPasskey)}
            disabled={connecting}
            aria-busy={connecting}
            type="button"
          >
            {pendingAction === "connect" ? (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            {pendingAction === "connect"
              ? "Working…"
              : "Sign in with an existing passkey"}
          </Button>
        </div>

        <ToastFeedback
          title="Wallet connection failed"
          message={error}
          variant="error"
          toastId="wallet-connection-error"
        />
      </DialogContent>
    </Dialog>
  );
}
