"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  connectWallet,
  ensureFunded,
  freighterSigner,
  type Signer,
} from "../lib/stellar";
import { fetchPrivyWallet, privySigner, type PrivyWallet } from "../lib/privy";

export type WalletType = "freighter" | "privy" | null;

type PrivyBits = {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
} | null;

type WalletState = {
  address: string;
  walletType: WalletType;
  connecting: boolean;
  error: string;
  privyEnabled: boolean;
  connectFreighter: () => Promise<void>;
  connectPrivy: () => Promise<void>;
  disconnect: () => Promise<void>;
  getSigner: () => Signer;
};

const WalletContext = createContext<WalletState | null>(null);
const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
function WalletCore({
  privy,
  children,
}: {
  privy: PrivyBits;
  children: ReactNode;
}) {
  const [address, setAddress] = useState("");
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const privyWalletRef = useRef<PrivyWallet | null>(null);

  useEffect(() => {
    if (!privy?.ready || !privy.authenticated || privyWalletRef.current) return;
    (async () => {
      const token = await privy.getAccessToken();
      if (!token) return;
      const w = await fetchPrivyWallet(token);
      privyWalletRef.current = w;
      await ensureFunded(w.address);
      setAddress(w.address);
      setWalletType("privy");
    })().catch((e) =>
      setError(e instanceof Error ? e.message : "Privy wallet error"),
    );
  }, [privy]);

  const connectFreighter = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const a = await connectWallet();
      setAddress(a);
      setWalletType("freighter");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Freighter connect failed");
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectPrivy = useCallback(async () => {
    if (!privy) {
      setError("Privy is not configured.");
      return;
    }
    setError("");
    if (!privy.authenticated) privy.login();
  }, [privy]);

  const disconnect = useCallback(async () => {
    if (walletType === "privy" && privy) await privy.logout();
    privyWalletRef.current = null;
    setAddress("");
    setWalletType(null);
  }, [walletType, privy]);

  const getSigner = useCallback((): Signer => {
    if (walletType === "freighter") return freighterSigner(address);
    if (walletType === "privy" && privy && privyWalletRef.current) {
      return privySigner(privyWalletRef.current, privy.getAccessToken);
    }
    throw new Error("Connect a wallet first.");
  }, [walletType, address, privy]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      walletType,
      connecting,
      error,
      privyEnabled: Boolean(privy),
      connectFreighter,
      connectPrivy,
      disconnect,
      getSigner,
    }),
    [
      address,
      walletType,
      connecting,
      error,
      privy,
      connectFreighter,
      connectPrivy,
      disconnect,
      getSigner,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const p = usePrivy();
  const bits: PrivyBits = {
    ready: p.ready,
    authenticated: p.authenticated,
    login: p.login,
    logout: p.logout,
    getAccessToken: p.getAccessToken,
  };
  return <WalletCore privy={bits}>{children}</WalletCore>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!appId) {
    // Privy not configured → Freighter-only.
    return <WalletCore privy={null}>{children}</WalletCore>;
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{ loginMethods: ["email", "google", "passkey", "wallet"] }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
