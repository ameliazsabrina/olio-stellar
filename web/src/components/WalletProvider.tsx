"use client";

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
import {
  connectPasskeyWallet,
  createPasskeyWallet,
  passkeyConfigured,
  type PasskeyWallet,
  passkeySigner,
} from "../lib/passkey";
import { type Signer, usernameOf } from "../lib/stellar";

export type WalletType = "passkey" | null;

type WalletState = {
  address: string;
  walletType: WalletType;
  connecting: boolean;
  error: string;
  passkeyEnabled: boolean;
  username: string | null;
  usernameResolved: boolean;
  setUsername: (u: string | null) => void;
  usernameModalOpen: boolean;
  openUsernameModal: () => void;
  closeUsernameModal: () => void;
  createPasskey: () => Promise<void>;
  connectPasskey: () => Promise<void>;
  disconnect: () => Promise<void>;
  getSigner: () => Signer;
};

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState("");
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [usernameResolved, setUsernameResolved] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const passkeyWalletRef = useRef<PasskeyWallet | null>(null);

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

  const createPasskey = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const w = await createPasskeyWallet("Olio");
      passkeyWalletRef.current = w;
      setAddress(w.contractId);
      setWalletType("passkey");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey creation failed");
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectPasskey = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const w = await connectPasskeyWallet();
      passkeyWalletRef.current = w;
      setAddress(w.contractId);
      setWalletType("passkey");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey connect failed");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    passkeyWalletRef.current = null;
    setAddress("");
    setWalletType(null);
    setUsernameModalOpen(false);
  }, []);

  const getSigner = useCallback((): Signer => {
    if (walletType === "passkey" && passkeyWalletRef.current) {
      return passkeySigner(passkeyWalletRef.current);
    }
    throw new Error("Connect a wallet first.");
  }, [walletType]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      walletType,
      connecting,
      error,
      passkeyEnabled: passkeyConfigured,
      username,
      usernameResolved,
      setUsername,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      createPasskey,
      connectPasskey,
      disconnect,
      getSigner,
    }),
    [
      address,
      walletType,
      connecting,
      error,
      username,
      usernameResolved,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      createPasskey,
      connectPasskey,
      disconnect,
      getSigner,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
