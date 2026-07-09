"use client";

import { useEffect } from "react";
import { CreateAccountForm } from "./CreateAccountForm";
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="username-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-ed-dark/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[440px]">
        <button
          type="button"
          aria-label="Close"
          className="absolute right-4 top-4 z-10 text-muted transition-colors hover:text-ink"
          onClick={onClose}
        >
          ✕
        </button>

        <h2 id="username-modal-title" className="sr-only">
          Claim your username
        </h2>

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
      </div>
    </div>
  );
}
