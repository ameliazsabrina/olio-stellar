"use client";

import { Fingerprint, LogIn } from "lucide-react";
import { useLayoutEffect } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
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
            onClick={createPasskey}
            disabled={connecting}
            aria-busy={connecting}
            type="button"
          >
            <Fingerprint className="size-4" aria-hidden="true" />
            {connecting ? "Working…" : "Create a passkey"}
          </Button>
          <Button
            variant="glass"
            className="min-h-11 w-full gap-2.5 disabled:opacity-55"
            onClick={connectPasskey}
            disabled={connecting}
            aria-busy={connecting}
            type="button"
          >
            <LogIn className="size-4" aria-hidden="true" />
            Sign in with an existing passkey
          </Button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
