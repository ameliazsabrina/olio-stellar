"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";

type NotesState = {
  notes: MyNote[];
  claimable: bigint;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  indexedAt: string | null;
  error: string | null;
  refresh: () => void;
};

export function useMyNotes(address: string | null | undefined): NotesState {
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [indexedAt, setIndexedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const hasResult = useRef(false);
  const previousAddress = useRef<string | null | undefined>(address);

  useEffect(() => {
    void tick;
    if (previousAddress.current !== address) {
      hasResult.current = false;
      previousAddress.current = address;
    }
    const account = address ? getAccount() : null;
    if (!account) {
      setNotes([]);
      setClaimable(0n);
      setLoading(false);
      setRefreshing(false);
      setStale(false);
      setIndexedAt(null);
      setError(null);
      hasResult.current = false;
      return;
    }
    let cancelled = false;
    const initiallyLoaded = hasResult.current;
    setLoading(!initiallyLoaded);
    setRefreshing(initiallyLoaded);
    setError(null);

    const applyResult = (result: Awaited<ReturnType<typeof scanMyNotes>>) => {
      setNotes(result.notes);
      setClaimable(result.claimable);
      setIndexedAt(result.indexedAt);
      setStale(result.health !== "healthy");
      hasResult.current = true;
    };

    void (async () => {
      try {
        if (!initiallyLoaded) {
          const cached = await scanMyNotes(account, { refresh: false });
          if (!cancelled && cached.mirrorAvailable) {
            applyResult(cached);
            setLoading(false);
            setRefreshing(true);
          }
        }
        const result = await scanMyNotes(account);
        if (!cancelled) applyResult(result);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load notes");
        setStale(hasResult.current);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!address) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const id = window.setInterval(onFocus, 20_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(id);
    };
  }, [address, refresh]);

  return {
    notes,
    claimable,
    loading,
    refreshing,
    stale,
    indexedAt,
    error,
    refresh,
  };
}
