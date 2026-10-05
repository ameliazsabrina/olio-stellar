"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvmSource } from "../../../lib/cctp";
import {
  ensureEvmChain,
  getEvmProvider,
  onEvmAccountsChanged,
  onEvmChainChanged,
} from "../burn";

export function useEvmPayerWallet(source: EvmSource | undefined) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    try {
      const provider = getEvmProvider();
      // Silent restoration never asks for account access or a network switch on mount.
      let accountsChanged = false;
      let chainChanged = false;
      const offAccounts = onEvmAccountsChanged((accounts) => {
        accountsChanged = true;
        if (!cancelled) setAddress(accounts[0] ?? null);
      });
      const offChain = onEvmChainChanged((hex) => {
        chainChanged = true;
        if (!cancelled) setChainId(Number(hex));
      });
      void provider
        .request({ method: "eth_accounts" })
        .then((accounts) => {
          if (!cancelled && !accountsChanged) setAddress(accounts[0] ?? null);
        })
        .catch(() => {});
      void provider
        .request({ method: "eth_chainId" })
        .then((hex) => {
          if (!cancelled && !chainChanged) setChainId(Number(hex));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        offAccounts();
        offChain();
      };
    } catch {
      /* A wallet is optional until the payer chooses Connect wallet. */
    }
  }, [source]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const provider = getEvmProvider();
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      if (!accounts[0]) throw new Error("No EVM account authorized.");
      setAddress(accounts[0]);
      if (source) await ensureEvmChain(source, provider);
      // Read accounts again because a wallet may change them while switching networks.
      const current = await provider.request({ method: "eth_accounts" });
      setAddress(current[0] ?? null);
      setChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to connect your EVM wallet.",
      );
    } finally {
      setConnecting(false);
    }
  }, [source]);

  return {
    address,
    onExpectedChain: !!source && chainId === source.chainId,
    connecting,
    error,
    connect,
  };
}
