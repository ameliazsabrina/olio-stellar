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
      <DialogContent className="max-w-[420px] gap-0 rounded-2xl border border-ed-line bg-ed-dark-2 p-6 text-ed-cream shadow-2xl sm:p-8 [&_[data-slot=dialog-close]]:text-ed-cream/50 [&_[data-slot=dialog-close]]:hover:bg-ed-cream/10 [&_[data-slot=dialog-close]]:hover:text-ed-cream">
        <DialogTitle className="text-lg font-semibold text-center">
          Create your account
        </DialogTitle>
        <p className="mx-auto mt-4 max-w-[32ch] text-center text-sm leading-6 text-ed-cream/70">
          A passkey secures your wallet with your device. No seed phrase, no
          gas.
        </p>

        <div className="mt-8 grid gap-3">
          <Button
            className="min-h-11 w-full gap-2.5 rounded-full border-ed-cream bg-ed-cream text-ed-dark hover:bg-white disabled:opacity-55"
            onClick={createPasskey}
            disabled={connecting}
            aria-busy={connecting}
            type="button"
          >
            <Fingerprint className="size-4" aria-hidden="true" />
            {connecting ? "Working…" : "Create a passkey"}
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 w-full gap-2.5 rounded-full text-ed-cream/80 hover:bg-ed-cream/[0.06] hover:text-ed-cream disabled:opacity-55"
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
