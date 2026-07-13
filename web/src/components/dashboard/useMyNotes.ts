"use client";

import { useCallback, useEffect, useState } from "react";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";

type NotesState = {
  notes: MyNote[];
  claimable: bigint;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useMyNotes(address: string | null | undefined): NotesState {
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void tick;
    const account = address ? getAccount() : null;
    if (!account) {
      setNotes([]);
      setClaimable(0n);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    scanMyNotes(account)
      .then((result) => {
        if (cancelled) return;
        setNotes(result.notes);
        setClaimable(result.claimable);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load notes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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

  return { notes, claimable, loading, error, refresh };
}
