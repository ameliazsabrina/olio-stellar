"use client";

import { useEffect } from "react";
import { useWallet } from "../WalletProvider";

function shortKey(k: string) {
  return k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "";
}

export function StellarWalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    address,
    walletType,
    connecting,
    error,
    connectExternal,
    disconnect,
  } = useWallet();
  const connected = walletType === "external" && Boolean(address);

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
      aria-labelledby="stellar-wallet-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-ed-dark/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[420px] rounded-2xl border border-ed-line bg-ed-dark-2 p-6 text-ed-cream shadow-2xl items-center">
        <button
          type="button"
          aria-label="Close"
          className="absolute right-4 top-4 text-ed-cream/50 transition-colors hover:text-ed-cream"
          onClick={onClose}
        >
          ✕
        </button>

        <h2
          id="stellar-wallet-title"
          className="text-lg font-semibold text-center"
        >
          Connect a Stellar wallet
        </h2>
        <p className="mt-1.5 text-sm text-ed-cream/64 text-center">
          Use Freighter or LOBSTR to connect your Stellar account.
        </p>

        {connected ? (
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-xl border border-ed-line bg-ed-cream/[0.04] px-4 py-3">
              <span className="text-sm text-ed-cream/72">Connected</span>
              <span className="font-mono text-sm" title={address}>
                {shortKey(address)}
              </span>
            </div>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-ed-line bg-transparent px-[18px] text-sm font-medium text-ed-cream transition-colors hover:border-ed-cream/40 hover:bg-ed-cream/[0.06]"
              onClick={disconnect}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-ed-cream bg-ed-cream px-[18px] text-sm font-semibold text-ed-dark transition-colors hover:bg-white disabled:cursor-default disabled:opacity-55"
            onClick={connectExternal}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
