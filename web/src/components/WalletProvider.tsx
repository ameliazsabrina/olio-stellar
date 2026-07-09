"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchPrivyWallet, type PrivyWallet, privySigner } from "../lib/privy";
import {
  connectExternalWallet,
  ensureFunded,
  externalWalletSigner,
  type Signer,
  usernameOf,
} from "../lib/stellar";

export type WalletType = "external" | "privy" | null;

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
  username: string | null;
  usernameResolved: boolean;
  setUsername: (u: string | null) => void;
  usernameModalOpen: boolean;
  openUsernameModal: () => void;
  closeUsernameModal: () => void;
  connectExternal: () => Promise<void>;
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
  const [username, setUsername] = useState<string | null>(null);
  const [usernameResolved, setUsernameResolved] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const privyWalletRef = useRef<PrivyWallet | null>(null);
  const privyLoginPendingRef = useRef(false);

  useEffect(() => {
    if (!address) {
      setUsername(null);
      setUsernameResolved(false);
      return;
    }
    let cancelled = false;
    setUsernameResolved(false);
    usernameOf(address)
      .then((name) => {
        if (!cancelled) {
          setUsername(name);
          setUsernameResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsername(null);
          setUsernameResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (address && usernameResolved && !username) setUsernameModalOpen(true);
  }, [address, usernameResolved, username]);

  const openUsernameModal = useCallback(() => setUsernameModalOpen(true), []);
  const closeUsernameModal = useCallback(() => setUsernameModalOpen(false), []);

  useEffect(() => {
    if (!privy?.ready) return;
    // User dismissed the login modal without authenticating: release the button.
    if (!privy.authenticated) {
      if (privyLoginPendingRef.current) {
        privyLoginPendingRef.current = false;
        setConnecting(false);
      }
      return;
    }
    if (privyWalletRef.current) return;
    (async () => {
      const token = await privy.getAccessToken();
      if (!token) return;
      const w = await fetchPrivyWallet(token);
      privyWalletRef.current = w;
      await ensureFunded(w.address);
      setAddress(w.address);
      setWalletType("privy");
    })()
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Privy wallet error"),
      )
      .finally(() => {
        privyLoginPendingRef.current = false;
        setConnecting(false);
      });
  }, [privy]);

  const connectExternal = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const a = await connectExternalWallet();
      setAddress(a);
      setWalletType("external");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connect failed");
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
    if (privy.authenticated) return;
    privyLoginPendingRef.current = true;
    setConnecting(true);
    privy.login();
  }, [privy]);

  const disconnect = useCallback(async () => {
    if (walletType === "privy" && privy) await privy.logout();
    privyWalletRef.current = null;
    setAddress("");
    setWalletType(null);
    setUsernameModalOpen(false);
  }, [walletType, privy]);

  const getSigner = useCallback((): Signer => {
    if (walletType === "external") return externalWalletSigner(address);
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
      username,
      usernameResolved,
      setUsername,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      connectExternal,
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
      username,
      usernameResolved,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      connectExternal,
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
    return <WalletCore privy={null}>{children}</WalletCore>;
  }
  return (
    <PrivyProvider appId={appId} config={{ loginMethods: ["email", "google"] }}>
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
