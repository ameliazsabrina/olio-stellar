"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isDashboardRoute } from "../lib/auth-routes";
import { DashboardBackground } from "./dashboard/DashboardBackground";
import { DashboardShell } from "./dashboard/DashboardShell";
import { PinDialog } from "./PinDialog";
import { UsernameModal } from "./UsernameModal";
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

  if (pathname === "/" || isDashboardRoute(pathname)) {
    return (
      <>
        <main className="block w-full m-0 p-0">{children}</main>
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
