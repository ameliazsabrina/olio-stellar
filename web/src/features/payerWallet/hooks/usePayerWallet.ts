"use client";

import { useCallback, useState } from "react";
import { connectPayerWallet, disconnectPayerWallet } from "../kit";

export function usePayerWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      setAddress(await connectPayerWallet());
    } catch (e) {
      // The kit rejects with { message } when the user closes the modal.
      const msg =
        e instanceof Error ? e.message : (e as { message?: string })?.message;
      if (msg && !/closed the modal/i.test(msg)) setError(msg);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectPayerWallet().catch(() => {});
    setAddress(null);
  }, []);

  return { address, connecting, error, connect, disconnect };
}
