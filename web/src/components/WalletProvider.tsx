"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";
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
import { DASHBOARD_PATH, isProtectedRoute } from "../lib/auth-routes";
import { deriveNoteSecrets, randomMaster } from "../lib/keys";
import {
  accountPubkeys,
  clearLocalAccount,
  deriveAndStoreAccount,
  getAccount,
  hasLocalAccount,
  syncLocalAccountIdentity,
} from "../lib/notes";
import { BadPinError } from "../lib/pin-errors";
import {
  type PrivyStellarWallet,
  privySigner,
  resolvePrivyStellarWallet,
} from "../lib/privy-wallet";
import {
  registerUsernameCache,
  resolveUsernameOnChain,
  type Signer,
  setUsernamePubkeys,
  usernameOf,
} from "../lib/stellar";
import { api } from "../trpc/client";
import type { PinMode } from "./PinDialog";

type WalletState = {
  address: string;
  connecting: boolean;
  error: string;
  authenticated: boolean;
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
  signIn: () => void;
  disconnect: () => Promise<void>;
  getSigner: () => Signer;
  privyPublicKey: string;
};

type WalletMapping = {
  contractId: string;
  privyWalletId: string;
  privyWalletAddress: string;
};

class RecoveryKeyGenerationMismatchError extends Error {
  constructor() {
    super(
      "Your saved recovery data does not match this account’s registered payment keys. Use the most recent recovery setup for this account; do not re-key or resend the payment.",
    );
    this.name = "RecoveryKeyGenerationMismatchError";
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const userId = user?.id ?? null;
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [username, setUsername] = useState<string | null>(null);
  const [usernameResolved, setUsernameResolved] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [accountUnlocked, setAccountUnlocked] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("unlock");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState("");
  const privyWalletRef = useRef<PrivyStellarWallet | null>(null);
  const mappingRef = useRef<WalletMapping | null>(null);
  const pendingMasterRef = useRef<Uint8Array | null>(null);
  const escrowMissingRef = useRef(false);
  const revisionRef = useRef(0);
  const sessionAbortedRef = useRef(false);
  const userRef = useRef(user);
  const createWalletRef = useRef(createWallet);
  const resolvedWalletRef = useRef<{
    userId: string;
    wallet: PrivyStellarWallet;
  } | null>(null);
  const setupRef = useRef<{
    key: string;
    promise: Promise<{
      wallet: PrivyStellarWallet;
      mapping: WalletMapping;
      openDashboard: boolean;
    }>;
  } | null>(null);

  userRef.current = user;
  createWalletRef.current = createWallet;

  const openPinModal = useCallback((mode: PinMode) => {
    setPinMode(mode);
    setPinError("");
    setPinModalOpen(true);
  }, []);

  const routeToDashboard = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== DASHBOARD_PATH &&
      !isProtectedRoute(window.location.pathname)
    ) {
      router.replace(DASHBOARD_PATH);
    }
  }, [router]);

  const activateMapping = useCallback(
    async (mapping: WalletMapping) => {
      if (sessionAbortedRef.current) return;
      const escrow = await api.wallets.getEscrow.query();
      if (sessionAbortedRef.current) return;
      mappingRef.current = mapping;
      escrowMissingRef.current = !escrow;
      setUsernameResolved(false);
      setAddress(mapping.contractId);
      if (!escrow) {
        // Do not publish or cache a new key generation until its recovery
        // envelope is durable. Username lookup below distinguishes a truly new
        // account from a legacy account that already received payments.
        pendingMasterRef.current = null;
        setAccountUnlocked(false);
      } else if (hasLocalAccount()) {
        setAccountUnlocked(true);
      } else {
        openPinModal("unlock");
      }
    },
    [openPinModal],
  );

  useEffect(() => {
    if (!ready) return;
    const revision = ++revisionRef.current;
    syncLocalAccountIdentity(authenticated ? userId : null);
    if (!authenticated || !userId) {
      sessionAbortedRef.current = true;
      setupRef.current = null;
      privyWalletRef.current = null;
      resolvedWalletRef.current = null;
      mappingRef.current = null;
      setAddress("");
      setAccountUnlocked(false);
      setSessionReady(true);
      return;
    }

    sessionAbortedRef.current = false;
    let cancelled = false;
    setConnecting(true);
    setError("");
    setSessionReady(false);
    const setupKey = `${userId}:${bootstrapRevision}`;
    if (setupRef.current?.key !== setupKey) {
      setupRef.current = {
        key: setupKey,
        promise: api.wallets.restore.mutate().then(async (restored) => {
          if (restored) {
            const wallet = {
              id: restored.privyWalletId,
              address: restored.privyWalletAddress,
            };
            resolvedWalletRef.current = { userId, wallet };
            return {
              wallet,
              mapping: restored,
              openDashboard: true,
            };
          }

          const currentUser = userRef.current;
          if (!currentUser || currentUser.id !== userId) {
            throw new Error("Privy session changed during wallet setup.");
          }
          const cachedWallet = resolvedWalletRef.current;
          const wallet =
            cachedWallet?.userId === userId
              ? cachedWallet.wallet
              : await resolvePrivyStellarWallet(
                  currentUser,
                  createWalletRef.current,
                );
          resolvedWalletRef.current = { userId, wallet };
          const mapping = await api.wallets.bootstrap.mutate({
            privyWalletId: wallet.id,
            privyWalletAddress: wallet.address,
          });
          return { wallet, mapping, openDashboard: true };
        }),
      };
    }
    setupRef.current.promise
      .then(async ({ wallet, mapping, openDashboard }) => {
        if (
          cancelled ||
          sessionAbortedRef.current ||
          revisionRef.current !== revision
        )
          return;
        privyWalletRef.current = wallet;
        await activateMapping(mapping);
        if (openDashboard) routeToDashboard();
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Privy wallet setup failed.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConnecting(false);
          setSessionReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    authenticated,
    userId,
    activateMapping,
    routeToDashboard,
    bootstrapRevision,
  ]);

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
      !address ||
      !usernameResolved ||
      !escrowMissingRef.current ||
      pinModalOpen
    ) {
      return;
    }

    if (username) {
      openPinModal("secure");
      return;
    }

    pendingMasterRef.current = randomMaster();
    openPinModal("set");
  }, [address, username, usernameResolved, pinModalOpen, openPinModal]);

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
    if (username && pendingMasterRef.current && !usernameModalOpen)
      openPinModal("set");
  }, [username, usernameModalOpen, openPinModal]);

  useEffect(() => {
    if (!address || !username || !accountUnlocked || pinModalOpen) return;
    const localAccount = getAccount();
    if (!localAccount) return;
    let cancelled = false;

    void Promise.all([
      accountPubkeys(localAccount),
      resolveUsernameOnChain(username),
    ])
      .then(([local, registered]) => {
        if (cancelled || !registered || registered.owner !== address) return;
        if (
          sameBytes(local.notePubkey, registered.note_pubkey) &&
          sameBytes(local.viewPubkey, registered.view_pubkey)
        ) {
          return;
        }

        setAccountUnlocked(false);
        openPinModal("unlock");
        setPinError(
          "Your cached payment keys do not match this account. Enter the latest six-digit recovery PIN to restore the registered keys.",
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [address, username, accountUnlocked, pinModalOpen, openPinModal]);

  const signIn = useCallback(() => {
    if (authenticated) setBootstrapRevision((value) => value + 1);
    else login();
  }, [authenticated, login]);

  const submitPin = useCallback(
    async (pin: string) => {
      const mapping = mappingRef.current;
      const privyWallet = privyWalletRef.current;
      if (!mapping || !privyWallet) return;
      setPinSubmitting(true);
      setPinError("");
      try {
        if (pinMode === "secure") {
          const master = randomMaster();
          if (username) {
            const account = deriveNoteSecrets(master);
            const { notePubkey, viewPubkey } = await accountPubkeys(account);
            await setUsernamePubkeys(
              privySigner({
                olioAddress: mapping.contractId,
                wallet: privyWallet,
                signRawHash,
              }),
              username,
              notePubkey,
              viewPubkey,
            );
            try {
              await registerUsernameCache(username);
            } catch (cause) {
              console.warn("re-key on-chain ok but Mongo mirror failed", cause);
            }
          }
          const { serializeEscrow, encryptMaster } = await import(
            "../lib/keys"
          );
          await api.wallets.saveEscrow.mutate(
            serializeEscrow(encryptMaster(master, pin)),
          );
          deriveAndStoreAccount(master);
          escrowMissingRef.current = false;
        } else if (pinMode === "set") {
          const master = pendingMasterRef.current ?? randomMaster();
          const { serializeEscrow, encryptMaster } = await import(
            "../lib/keys"
          );
          await api.wallets.saveEscrow.mutate(
            serializeEscrow(encryptMaster(master, pin)),
          );
          deriveAndStoreAccount(master);
          pendingMasterRef.current = null;
          escrowMissingRef.current = false;
        } else {
          const wire = await api.wallets.getEscrow.query();
          if (!wire) {
            openPinModal("secure");
            return;
          }
          const { decryptMaster, deserializeEscrow } = await import(
            "../lib/keys"
          );
          let master: Uint8Array | undefined;
          try {
            master = decryptMaster(deserializeEscrow(wire), pin);
          } catch {
            throw new BadPinError();
          }
          try {
            if (username) {
              const [recovered, registered] = await Promise.all([
                accountPubkeys(deriveNoteSecrets(master)),
                resolveUsernameOnChain(username),
              ]);
              if (
                registered?.owner === mapping.contractId &&
                (!sameBytes(recovered.notePubkey, registered.note_pubkey) ||
                  !sameBytes(recovered.viewPubkey, registered.view_pubkey))
              ) {
                throw new RecoveryKeyGenerationMismatchError();
              }
            }
            deriveAndStoreAccount(master);
          } finally {
            master.fill(0);
          }
        }
        setAccountUnlocked(true);
        setPinModalOpen(false);
      } catch (cause) {
        setPinError(
          cause instanceof BadPinError
            ? "Incorrect PIN. Try again."
            : cause instanceof Error
              ? cause.message
              : "Something went wrong.",
        );
      } finally {
        setPinSubmitting(false);
      }
    },
    [pinMode, username, openPinModal, signRawHash],
  );

  const disconnect = useCallback(async () => {
    revisionRef.current += 1;
    sessionAbortedRef.current = true;
    setupRef.current = null;
    privyWalletRef.current = null;
    resolvedWalletRef.current = null;
    mappingRef.current = null;
    pendingMasterRef.current = null;
    escrowMissingRef.current = false;
    clearLocalAccount();
    syncLocalAccountIdentity(null);
    setAddress("");
    setUsernameModalOpen(false);
    setPinModalOpen(false);
    setAccountUnlocked(false);
    await logout();
    // Privy logout and an already-resolved bootstrap can settle in the same
    // microtask turn. Reassert the disconnected state after logout completes.
    privyWalletRef.current = null;
    mappingRef.current = null;
    setAddress("");
    setUsernameModalOpen(false);
    setPinModalOpen(false);
    setAccountUnlocked(false);
  }, [logout]);

  const getSigner = useCallback((): Signer => {
    const mapping = mappingRef.current;
    const wallet = privyWalletRef.current;
    if (!mapping || !wallet) throw new Error("Connect a Privy wallet first.");
    return privySigner({
      olioAddress: mapping.contractId,
      wallet,
      signRawHash,
    });
  }, [signRawHash]);

  const openUsernameModal = useCallback(() => setUsernameModalOpen(true), []);
  const closeUsernameModal = useCallback(() => setUsernameModalOpen(false), []);
  const closePinModal = useCallback(() => {
    if (pinMode !== "set") setPinModalOpen(false);
  }, [pinMode]);
  const promptUnlock = useCallback(
    () => openPinModal("unlock"),
    [openPinModal],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      connecting,
      error,
      authenticated,
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
      signIn,
      disconnect,
      getSigner,
      privyPublicKey: privyWalletRef.current?.address ?? "",
    }),
    [
      address,
      connecting,
      error,
      authenticated,
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
      signIn,
      disconnect,
      getSigner,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}
