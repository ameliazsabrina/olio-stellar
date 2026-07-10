"use client";

import { useCallback, useEffect, useState } from "react";
import { type AccountStatus, accountStatus } from "../lib/stellar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { useWallet } from "./WalletProvider";

const fmt = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : v;
};

export function WalletStatus() {
  const { address, walletType } = useWallet();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    try {
      setStatus(await accountStatus(address));
    } catch {
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!address) return null;

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="gap-3 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Wallet</h2>
        <Badge variant="secondary">{walletType}</Badge>
      </div>
      <button
        type="button"
        className="break-all font-mono text-sm text-muted-foreground cursor-pointer text-left hover:text-olive-deep"
        onClick={copy}
        title="Copy address"
      >
        {copied ? "Copied ✓" : address}
      </button>
      <div className="my-2 grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-sage/40 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            USDC
          </span>
          <span className="font-mono text-lg font-semibold text-ink">
            {status ? fmt(status.usdc) : "…"}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={refresh} disabled={busy}>
          {busy ? "Checking…" : "Refresh"}
        </Button>
      </div>
    </Card>
  );
}
