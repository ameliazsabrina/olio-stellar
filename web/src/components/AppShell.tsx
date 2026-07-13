"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { StellarWalletModal } from "./landing/StellarWalletModal";
import { UsernameModal } from "./UsernameModal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useWallet } from "./WalletProvider";

function shortKey(k: string) {
  return k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "";
}

export function AppShell({ children }: { children: ReactNode }) {
  const {
    address,
    connecting,
    username,
    usernameResolved,
    sessionReady,
    openUsernameModal,
    usernameModalOpen,
    closeUsernameModal,
    disconnect,
  } = useWallet();
  const pathname = usePathname();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  // On /pay/* the visitor is an external PAYER using their own wallet (handled by
  // PayForm), not an Olio account holder — never nudge them into passkey sign-in.
  const isPay = pathname.startsWith("/pay");

  const usernameModal = (
    <UsernameModal open={usernameModalOpen} onClose={closeUsernameModal} />
  );
  const walletModal = (
    <StellarWalletModal
      open={walletModalOpen}
      onClose={() => setWalletModalOpen(false)}
    />
  );

  if (pathname === "/" || pathname.startsWith("/dashboard")) {
    return (
      <>
        <main className="block w-full m-0 p-0">{children}</main>
        {usernameModal}
        {walletModal}
      </>
    );
  }

  return (
    <>
      <header className="border-b border-line bg-gradient-to-b from-[#f7f6f0] to-[#f2f1e8]">
        <div className="mx-auto flex w-[min(980px,calc(100%-32px))] items-center justify-between gap-4 py-4">
          <Image
            src="/assets/olio.svg"
            alt="logo"
            width={40}
            height={40}
            className="h-10 w-10"
          />
          <nav className="flex items-center gap-[18px]">
            <Link
              href="/"
              className="text-[15px] font-semibold text-muted-foreground hover:text-olive-deep"
            >
              Home
            </Link>
            {!isPay && address && usernameResolved && !username && (
              <button
                type="button"
                className="text-[15px] font-semibold text-olive-deep transition-colors hover:text-olive"
                onClick={openUsernameModal}
              >
                Claim username
              </button>
            )}
            {isPay ? null : !sessionReady ? (
              <Button className="min-h-11" disabled>
                Signing in…
              </Button>
            ) : address ? (
              <Badge
                variant="secondary"
                className="h-auto cursor-pointer rounded-full px-3 py-1.5 font-sans text-xs hover:border-olive"
                title={address}
                onClick={disconnect}
              >
                {username ? `@${username}` : shortKey(address)}
              </Badge>
            ) : (
              <Button
                className="min-h-11"
                onClick={() => setWalletModalOpen(true)}
                disabled={connecting}
              >
                {connecting ? "Signing in…" : "Sign In"}
              </Button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto grid w-full gap-[18px] pb-20 [&>*]:mx-auto [&>*]:w-[min(720px,calc(100%-32px))]">
        {children}
      </main>
      {isPay ? null : usernameModal}
      {isPay ? null : walletModal}
    </>
  );
}
