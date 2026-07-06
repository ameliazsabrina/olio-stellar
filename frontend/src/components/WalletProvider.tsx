"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import { connectWallet } from "../lib/stellar";

type WalletState = {
  address: string;
  connecting: boolean;
  connect: () => Promise<string>;
  error: string;
};

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const connect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const addr = await connectWallet();
      setAddress(addr);
      return addr;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to connect";
      setError(msg);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, []);

  return (
    <WalletContext.Provider value={{ address, connecting, connect, error }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
