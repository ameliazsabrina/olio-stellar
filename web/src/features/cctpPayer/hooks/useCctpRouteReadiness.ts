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

const REASON_MESSAGES: Record<string, string> = {
  unsupported_source: "This chain isn't a supported CCTP source.",
  eligibility_not_confirmed: "Payments from this chain aren't open yet.",
  route_not_certified: "Payments from this chain are temporarily paused.",
  upstream_denied_investigate:
    "Circle's attestation service is refusing requests from Olio. Payments are paused until an operator reviews it.",
  upstream_denied:
    "Circle's attestation service is refusing requests. Try again later.",
  upstream_backoff:
    "Circle's attestation service is recovering. Try again in a moment.",
  worker_unavailable:
    "Olio's settlement worker is offline. Payments from this chain resume automatically once it is back.",
  storage_not_ready: "Olio's payment storage isn't ready. Try again shortly.",
  provider_fee_requires_gross_up:
    "Circle is charging a transfer fee on this route, which Olio doesn't support yet.",
  dependency_unavailable:
    "A service Olio depends on is unavailable. Try again shortly.",
  throttled: "Too many attestation requests right now. Try again in a moment.",
  timeout:
    "Circle's attestation service is slow to respond. Try again shortly.",
  transport:
    "Olio couldn't reach Circle's attestation service. Try again shortly.",
  configuration: "Cross-chain payments aren't configured on this deployment.",
  unsupported: "This route isn't available right now.",
};

export function describeReadiness(readiness: RouteReadiness): string {
  return (
    REASON_MESSAGES[readiness.reason] ??
    "Cross-chain payments from this chain are temporarily unavailable."
  );
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
          message:
            "Olio couldn't confirm this route is open. Try again shortly.",
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
