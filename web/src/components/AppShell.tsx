"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isProtectedRoute } from "../lib/auth-routes";
import { moneyGramBannerCopy } from "../lib/moneygram-status";
import { DashboardBackground } from "./dashboard/DashboardBackground";
import { DashboardShell } from "./dashboard/DashboardShell";
import { PinDialog } from "./PinDialog";
import { UsernameModal } from "./UsernameModal";
import { StickyBanner } from "./ui/sticky-banner";
import { useWallet } from "./WalletProvider";

export function AppShell({ children }: { children: ReactNode }) {
  const {
    usernameModalOpen,
    closeUsernameModal,
    pinModalOpen,
    pinMode,
    pinSubmitting,
    pinError,
    submitPin,
    closePinModal,
  } = useWallet();
  const pathname = usePathname();
  const isPay = pathname.startsWith("/pay");
  const protectedRoute = isProtectedRoute(pathname);

  const moneyGramBanner =
    protectedRoute && moneyGramBannerCopy ? (
      <StickyBanner
        className="z-[80] min-h-10 border-b border-ed-gold/30 bg-ed-dark-2 px-12 py-2 text-center text-sm font-medium text-ed-cream"
        hideOnScroll={false}
      >
        <p role="status" aria-label="MoneyGram integration status">
          {moneyGramBannerCopy}{" "}
          <a
            href="https://www.moneygram.com/us/en/ramps"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ed-cream underline decoration-ed-cream/70 underline-offset-2 transition-colors hover:text-ed-cream/80"
          >
            Get to know about MoneyGram
          </a>
        </p>
      </StickyBanner>
    ) : null;

  const usernameModal = (
    <UsernameModal open={usernameModalOpen} onClose={closeUsernameModal} />
  );
  const pinModal = (
    <PinDialog
      open={pinModalOpen}
      mode={pinMode}
      submitting={pinSubmitting}
      error={pinError}
      onSubmit={submitPin}
      onClose={closePinModal}
    />
  );

  if (pathname === "/" || protectedRoute) {
    return (
      <>
        {moneyGramBanner}
        <div className="block w-full m-0 p-0">{children}</div>
        {usernameModal}
        {pinModal}
      </>
    );
  }

  if (isPay) {
    return (
      <DashboardBackground>
        <DashboardShell contentClassName="flex min-h-svh max-w-3xl flex-col">
          <header className="mb-0 flex min-w-0 items-center justify-center">
            <Link href="/" aria-label="Olio home">
              <Image
                src="/assets/olio-white.svg"
                alt="Olio"
                width={40}
                height={40}
                className="size-16"
              />
            </Link>
          </header>
          <div className="grid flex-1 content-center gap-5 py-8">
            {children}
          </div>
        </DashboardShell>
      </DashboardBackground>
    );
  }

  return children;
}
