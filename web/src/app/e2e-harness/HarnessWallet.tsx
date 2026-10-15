"use client";

import type { ReactNode } from "react";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  StaticWalletProvider,
  type WalletState,
} from "@/components/WalletProvider";

const noop = () => {};

// A signed-in, unlocked account. tRPC calls are stubbed by the Playwright fixtures.
const HARNESS_WALLET: WalletState = {
  address: "CE2EHARNESSACCOUNT",
  connecting: false,
  error: "",
  authenticated: true,
  username: "ayu",
  usernameResolved: true,
  sessionReady: true,
  setUsername: noop,
  usernameModalOpen: false,
  openUsernameModal: noop,
  closeUsernameModal: noop,
  accountUnlocked: true,
  pinModalOpen: false,
  pinMode: "unlock",
  pinSubmitting: false,
  pinError: "",
  submitPin: async () => {},
  closePinModal: noop,
  promptUnlock: noop,
  signIn: noop,
  disconnect: async () => {},
  getSigner: () => {
    throw new Error("The E2E harness cannot sign.");
  },
  privyPublicKey: "",
};

export function HarnessWallet({ children }: { children: ReactNode }) {
  return (
    <StaticWalletProvider value={HARNESS_WALLET}>
      <DashboardBackground>
        <DashboardShell navigation>{children}</DashboardShell>
      </DashboardBackground>
    </StaticWalletProvider>
  );
}
