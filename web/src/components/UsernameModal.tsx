"use client";

import { CreateAccountForm } from "./CreateAccountForm";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { useWallet } from "./WalletProvider";

// Onboarding modal shown to a connected user who has no username yet. Wraps the
// shared CreateAccountForm; on a successful claim it updates the wallet context
// (so the nav reflects @username) and closes.
export function UsernameModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { setUsername, error } = useWallet();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="sr-only">Claim your username</DialogTitle>

        <CreateAccountForm
          onClaimed={(name) => {
            setUsername(name);
            onClose();
          }}
        />

        {error ? (
          <p className="mt-3 text-center text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
