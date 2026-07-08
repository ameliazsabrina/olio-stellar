"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { accountStatus, ensureFunded, type AccountStatus } from "../lib/stellar";
import {
  balcell,
  balgrid,
  ballabel,
  balval,
  btnSecondary,
  inline,
  linkrow,
  panel,
  tag,
} from "../lib/ui";

const fmt = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;
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

  const fund = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    await ensureFunded(address);
    await refresh();
  }, [address, refresh]);

  if (!address) return null;

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={panel}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Wallet</h2>
        <span className={tag}>{walletType}</span>
      </div>
      <button
        className={`${linkrow} cursor-pointer text-left hover:text-olive-deep`}
        onClick={copy}
        title="Copy address"
      >
        {copied ? "Copied ✓" : address}
      </button>
      <div className={balgrid}>
        <div className={balcell}>
          <span className={ballabel}>XLM</span>
          <span className={balval}>{status ? fmt(status.xlm) : "…"}</span>
        </div>
        <div className={balcell}>
          <span className={ballabel}>USDC</span>
          <span className={balval}>{status ? fmt(status.usdc) : "…"}</span>
        </div>
        <div className={balcell}>
          <span className={ballabel}>USDC trustline</span>
          <span className={balval}>{status ? (status.hasUsdcTrustline ? "yes" : "no") : "…"}</span>
        </div>
      </div>
      <div className={inline}>
        <button className={btnSecondary} onClick={refresh} disabled={busy}>
          {busy ? "Checking…" : "Refresh"}
        </button>
        {status && (!status.exists || Number(status.xlm) === 0) ? (
          <button className={btnSecondary} onClick={fund} disabled={busy}>
            Fund (friendbot)
          </button>
        ) : null}
      </div>
    </div>
  );
}
