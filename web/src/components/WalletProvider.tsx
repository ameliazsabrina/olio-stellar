"use client";

import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { DASHBOARD_PATH } from "../lib/auth-routes";
import {
  forgetPasskeySession,
  rememberPasskeySession,
} from "../lib/auth-session";
import { deriveNoteSecrets, randomMaster } from "../lib/keys";
import {
  accountPubkeys,
  deriveAndStoreAccount,
  hasLocalAccount,
} from "../lib/notes";
import {
  BadPinError,
  connectPasskeyWallet,
  createMasterEscrow,
  createPasskeyWallet,
  forgetPasskeyWallet,
  type PasskeyWallet,
  passkeyConfigured,
  passkeySigner,
  restorePasskeyWallet,
  saveMasterEscrow,
  unlockMasterEscrow,
} from "../lib/passkey";
import {
  registerUsernameCache,
  setUsernamePubkeys,
  type Signer,
  usernameOf,
} from "../lib/stellar";
import type { PinMode } from "./PinDialog";

export type WalletType = "passkey" | null;

type WalletState = {
  address: string;
  walletType: WalletType;
  connecting: boolean;
  error: string;
  passkeyEnabled: boolean;
  username: string | null;
  usernameResolved: boolean;
  sessionReady: boolean;
  setUsername: (u: string | null) => void;
  usernameModalOpen: boolean;
  openUsernameModal: () => void;
  closeUsernameModal: () => void;
  accountUnlocked: boolean;
  pinModalOpen: boolean;
  pinMode: PinMode;
  pinSubmitting: boolean;
  pinError: string;
  submitPin: (pin: string) => Promise<void>;
  closePinModal: () => void;
  promptUnlock: () => void;
  createPasskey: () => Promise<void>;
  connectPasskey: () => Promise<void>;
  disconnect: () => Promise<void>;
  getSigner: () => Signer;
};

const WalletContext = createContext<WalletState | null>(null);

function isPasskeyCancellation(e: unknown): boolean {
  const names = new Set(["NotAllowedError", "AbortError"]);
  const node = e as { name?: unknown; cause?: unknown; message?: unknown };
  if (typeof node?.name === "string" && names.has(node.name)) return true;
  const cause = node?.cause as { name?: unknown } | undefined;
  if (typeof cause?.name === "string" && names.has(cause.name)) return true;
  const msg = typeof node?.message === "string" ? node.message : "";
  return /operation either timed out or was not allowed/i.test(msg);
}

function reportPasskeyError(e: unknown, fallback: string): string {
  if (isPasskeyCancellation(e)) {
    toast.info("Passkey prompt was cancelled. Try again when you're ready.", {
      id: "passkey-cancelled",
    });
    return "";
  }
  return e instanceof Error ? e.message : fallback;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [usernameResolved, setUsernameResolved] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [accountUnlocked, setAccountUnlocked] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("unlock");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState("");
  const passkeyWalletRef = useRef<PasskeyWallet | null>(null);
  const pendingMasterRef = useRef<Uint8Array | null>(null);
  const sessionRevisionRef = useRef(0);

  useEffect(() => {
    setAccountUnlocked(hasLocalAccount());
  }, []);

  const openPinModal = useCallback((mode: PinMode) => {
    setPinMode(mode);
    setPinError("");
    setPinModalOpen(true);
  }, []);

  const hydrateAccount = useCallback(() => {
    if (hasLocalAccount()) setAccountUnlocked(true);
    else openPinModal("unlock");
  }, [openPinModal]);

  const routeToDashboard = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== DASHBOARD_PATH) {
      router.replace(DASHBOARD_PATH);
    }
  }, [router]);

  useEffect(() => {
    if (!passkeyConfigured) {
      setSessionReady(true);
      return;
    }
    let cancelled = false;
    const restoreRevision = sessionRevisionRef.current;
    restorePasskeyWallet()
      .then((w) => {
        if (cancelled) return;
        if (!w) {
          if (sessionRevisionRef.current === restoreRevision) {
            forgetPasskeySession();
          }
          return;
        }
        if (sessionRevisionRef.current !== restoreRevision) return;
        passkeyWalletRef.current = w;
        rememberPasskeySession();
        setAddress(w.contractId);
        setWalletType("passkey");
        hydrateAccount();
      })
      .catch(() => {
        if (!cancelled && sessionRevisionRef.current === restoreRevision) {
          forgetPasskeySession();
        }
      })
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrateAccount]);

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
    if (
      address &&
      usernameResolved &&
      !username &&
      accountUnlocked &&
      !pinModalOpen
    ) {
      setUsernameModalOpen(true);
    }
  }, [address, usernameResolved, username, accountUnlocked, pinModalOpen]);

  useEffect(() => {
    if (username && pendingMasterRef.current && !usernameModalOpen) {
      openPinModal("set");
    }
  }, [username, usernameModalOpen, openPinModal]);

  const openUsernameModal = useCallback(() => setUsernameModalOpen(true), []);
  const closeUsernameModal = useCallback(() => setUsernameModalOpen(false), []);

  const createPasskey = useCallback(async () => {
    setConnecting(true);
    setError("");
    sessionRevisionRef.current += 1;
    try {
      const w = await createPasskeyWallet("Olio");
      passkeyWalletRef.current = w;
      rememberPasskeySession();
      setAddress(w.contractId);
      setWalletType("passkey");
      setSessionReady(true);
      const master = randomMaster();
      pendingMasterRef.current = master;
      deriveAndStoreAccount(master);
      setAccountUnlocked(true);
      routeToDashboard();
    } catch (e) {
      setError(reportPasskeyError(e, "Passkey creation failed"));
    } finally {
      setConnecting(false);
    }
  }, [routeToDashboard]);

  const connectPasskey = useCallback(async () => {
    setConnecting(true);
    setError("");
    sessionRevisionRef.current += 1;
    try {
      const w = await connectPasskeyWallet();
      passkeyWalletRef.current = w;
      rememberPasskeySession();
      setAddress(w.contractId);
      setWalletType("passkey");
      setSessionReady(true);
      hydrateAccount();
      routeToDashboard();
    } catch (e) {
      setError(reportPasskeyError(e, "Passkey connect failed"));
    } finally {
      setConnecting(false);
    }
  }, [routeToDashboard, hydrateAccount]);

  const submitPin = useCallback(
    async (pin: string) => {
      const w = passkeyWalletRef.current;
      if (!w) return;
      setPinSubmitting(true);
      setPinError("");
      try {
        if (pinMode === "secure") {
          const master = randomMaster();
          if (username) {
            const acct = deriveNoteSecrets(master);
            const { notePubkey, viewPubkey } = await accountPubkeys(acct);
            await setUsernamePubkeys(
              passkeySigner(w),
              username,
              notePubkey,
              viewPubkey,
            );
            try {
              await registerUsernameCache(username);
            } catch (err) {
              console.warn("re-key on-chain ok but Mongo mirror failed", err);
            }
          }
          await saveMasterEscrow(w.contractId, w.keyId, master, pin);
          deriveAndStoreAccount(master);
        } else if (pinMode === "set") {
          const pendingMaster = pendingMasterRef.current;
          const master = pendingMaster
            ? pendingMaster
            : await createMasterEscrow(w.contractId, w.keyId, pin);
          if (pendingMaster) {
            await saveMasterEscrow(w.contractId, w.keyId, pendingMaster, pin);
          }
          deriveAndStoreAccount(master);
          pendingMasterRef.current = null;
        } else {
          const master = await unlockMasterEscrow(w.keyId, pin);
          if (!master) {
            openPinModal("secure");
            return;
          }
          deriveAndStoreAccount(master);
        }
        setAccountUnlocked(true);
        setPinModalOpen(false);
      } catch (e) {
        setPinError(
          e instanceof BadPinError
            ? "Incorrect PIN. Try again."
            : e instanceof Error
              ? e.message
              : "Something went wrong.",
        );
      } finally {
        setPinSubmitting(false);
      }
    },
    [pinMode, username, openPinModal],
  );

  const closePinModal = useCallback(() => {
    if (pinMode !== "set") setPinModalOpen(false);
  }, [pinMode]);

  const promptUnlock = useCallback(
    () => openPinModal("unlock"),
    [openPinModal],
  );

  const disconnect = useCallback(async () => {
    sessionRevisionRef.current += 1;
    passkeyWalletRef.current = null;
    pendingMasterRef.current = null;
    forgetPasskeyWallet();
    forgetPasskeySession();
    setAddress("");
    setWalletType(null);
    setUsernameModalOpen(false);
    setPinModalOpen(false);
    setAccountUnlocked(false);
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
      sessionReady,
      setUsername,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      accountUnlocked,
      pinModalOpen,
      pinMode,
      pinSubmitting,
      pinError,
      submitPin,
      closePinModal,
      promptUnlock,
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
      sessionReady,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      accountUnlocked,
      pinModalOpen,
      pinMode,
      pinSubmitting,
      pinError,
      submitPin,
      closePinModal,
      promptUnlock,
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
