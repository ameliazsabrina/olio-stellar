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
  registerUsername,
  registerUsernameCache,
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
  const sessionRevisionRef = useRef(0);

  // localStorage note secrets are a cache of the recoverable master. If this
  // device already holds them, the account is unlocked without a PIN prompt.
  useEffect(() => {
    setAccountUnlocked(hasLocalAccount());
  }, []);

  const openPinModal = useCallback((mode: PinMode) => {
    setPinMode(mode);
    setPinError("");
    setPinModalOpen(true);
  }, []);

  // Called once an address is established (create / connect / silent restore):
  // reuse cached secrets if present, otherwise prompt to unlock the escrow.
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
  }, []);

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
    // Wait for the master to be unlocked: CreateAccountForm registers pubkeys
    // derived from it, so prompting for a username before then would desync.
    if (address && usernameResolved && !username && accountUnlocked) {
      setUsernameModalOpen(true);
    }
  }, [address, usernameResolved, username, accountUnlocked]);

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
      // Brand-new wallet → mint + escrow a fresh master before anything else.
      openPinModal("set");
      routeToDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey creation failed");
    } finally {
      setConnecting(false);
    }
  }, [routeToDashboard, openPinModal]);

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
      setError(e instanceof Error ? e.message : "Passkey connect failed");
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
          // Legacy random-key account: mint a new master, and if a username was
          // already claimed with the old keys, overwrite its on-chain pubkeys
          // (registry `register` overwrites) BEFORE persisting anything locally,
          // so a rejected signature leaves the old cache untouched.
          const master = randomMaster();
          if (username) {
            const acct = deriveNoteSecrets(master);
            const { notePubkey, viewPubkey } = await accountPubkeys(acct);
            await registerUsername(
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
          const master = await createMasterEscrow(w.contractId, w.keyId, pin);
          deriveAndStoreAccount(master);
        } else {
          const master = await unlockMasterEscrow(w.keyId, pin);
          if (!master) {
            // No escrow on file → legacy account. Offer to re-key instead of
            // dead-ending; the PIN just typed is discarded (fields reset).
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

  // The set flow is mandatory (no master → can't claim/receive), so ignore
  // dismiss requests there; unlock is dismissable into the locked state.
  const closePinModal = useCallback(() => {
    if (pinMode !== "set") setPinModalOpen(false);
  }, [pinMode]);

  // Re-open the unlock prompt after the user dismissed it (locked dashboard).
  const promptUnlock = useCallback(() => openPinModal("unlock"), [openPinModal]);

  const disconnect = useCallback(async () => {
    sessionRevisionRef.current += 1;
    passkeyWalletRef.current = null;
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
