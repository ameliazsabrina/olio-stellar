"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { useWallet } from "./WalletProvider";

function shortKey(k: string) {
  return k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "";
}

export function AppShell({ children }: { children: ReactNode }) {
  const { address, walletType, connecting, connectPrivy, disconnect } = useWallet();

  return (
    <>
      <header className="appheader">
        <div className="appheader-inner">
          <Link href="/" className="wordmark" aria-label="Olio home">
            Oli<span>o</span>
          </Link>
          <nav className="nav">
            <Link href="/">Home</Link>
            <Link href="/wallet">Wallet</Link>
            {address ? (
              <span className="pubkey" title={`${address} (${walletType})`} onClick={disconnect}>
                {shortKey(address)}
              </span>
            ) : (
              <button onClick={connectPrivy} disabled={connecting}>
                {connecting ? "Signing in…" : "Sign In"}
              </button>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
