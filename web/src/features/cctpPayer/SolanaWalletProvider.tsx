"use client";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { type ReactNode, useMemo } from "react";
import { solanaSource } from "../../lib/cctp";
import "@solana/wallet-adapter-react-ui/styles.css";

// Solana wallet context scoped to the CCTP pay flow; empty adapter list relies on Wallet-Standard auto-discovery.
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => solanaSource.rpcUrl, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
