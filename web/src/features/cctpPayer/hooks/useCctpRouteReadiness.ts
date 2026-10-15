"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CCTP_CHAIN_DOMAIN, type CctpChain } from "../../../lib/cctp";
import { api } from "../../../trpc/client";
import { detectEvmSourceDomain, onEvmChainChanged } from "../burn";

export type RouteReadiness = {
  state:
    | "enabled"
    | "temporarily_unavailable"
    | "unsupported"
    | "eligibility_unavailable";
  reason: string;
  checkedAt: string;
  retryAfterMs: number;
  sourceDomain: number;
};

export type RouteGate =
  | { kind: "checking" }
  | { kind: "no_chain" }
  | { kind: "ready"; readiness: RouteReadiness }
  | {
      kind: "blocked";
      readiness: RouteReadiness | null;
      message: string;
      retryAt: number | null;
    };

// Payer-facing copy: say whether to wait or come back, not which upstream failed.
const BUSY = "Payments from this network are busy. Try again in a moment.";
const PAUSED = "Payments from this network are paused for now.";
const UNSUPPORTED = "Payments from this network aren't supported yet.";

const REASON_MESSAGES: Record<string, string> = {
  unsupported_source: UNSUPPORTED,
  eligibility_not_confirmed: UNSUPPORTED,
  route_not_certified: PAUSED,
  upstream_denied_investigate: PAUSED,
  upstream_denied: PAUSED,
  upstream_backoff: BUSY,
  worker_unavailable:
    "Payments from this network are paused and will resume automatically.",
  storage_not_ready: BUSY,
  provider_fee_requires_gross_up: UNSUPPORTED,
  dependency_unavailable: BUSY,
  throttled: BUSY,
  timeout: BUSY,
  transport: BUSY,
  configuration: "Paying from other networks isn't available right now.",
  unsupported: UNSUPPORTED,
};

export function describeReadiness(readiness: RouteReadiness): string {
  return REASON_MESSAGES[readiness.reason] ?? BUSY;
}

export function useCctpRouteReadiness(
  chain: CctpChain,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  // Seed pinned routes immediately so wallet detection cannot briefly open the gate.
  const pinned = CCTP_CHAIN_DOMAIN[chain] ?? null;
  const [sourceDomain, setSourceDomain] = useState<number | null>(pinned);
  const [gate, setGate] = useState<RouteGate>({ kind: "checking" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useRef<() => void>(() => {});

  useEffect(() => {
    if (pinned !== null) {
      setSourceDomain(pinned);
      return;
    }
    let cancelled = false;
    const detect = () => {
      void detectEvmSourceDomain().then((domain) => {
        if (!cancelled) setSourceDomain(domain);
      });
    };
    detect();
    const off = onEvmChainChanged(detect);
    return () => {
      cancelled = true;
      off();
    };
  }, [pinned]);

  useEffect(() => {
    if (!enabled) return;
    if (sourceDomain === null) {
      setGate({ kind: "no_chain" });
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const readiness = await api.cctp.readiness.query({ sourceDomain });
        if (cancelled) return;
        if (readiness.state === "enabled")
          setGate({ kind: "ready", readiness });
        else
          setGate({
            kind: "blocked",
            readiness,
            message: describeReadiness(readiness),
            retryAt:
              readiness.state === "temporarily_unavailable"
                ? Date.now() + readiness.retryAfterMs
                : null,
          });
        timer.current = setTimeout(
          run,
          Math.min(60_000, Math.max(5000, readiness.retryAfterMs)),
        );
      } catch {
        if (cancelled) return;
        setGate({
          kind: "blocked",
          readiness: null,
          message: BUSY,
          retryAt: Date.now() + 15_000,
        });
        timer.current = setTimeout(run, 15_000);
      }
    };
    check.current = () => {
      if (timer.current) clearTimeout(timer.current);
      setGate({ kind: "checking" });
      void run();
    };
    setGate({ kind: "checking" });
    void run();
    return () => {
      cancelled = true;
      check.current = () => {};
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sourceDomain, enabled]);

  const recheck = useCallback(() => check.current(), []);
  return { sourceDomain, gate, recheck };
}
