"use client";

import { Keypair } from "@stellar/stellar-sdk";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  ExternalLink,
  Loader,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  authenticate,
  fetchAnchorInfo,
  getSep24Transaction,
} from "../../lib/anchor";
import {
  bridgeUsdcBalance,
  clearPersistedBridge,
  dismissRampSession,
  listRampSessions,
  type RampSession,
  updateRampSession,
} from "../../lib/bridge";
import { fromBaseUnits } from "../../lib/crypto";
import { moneyGramCashInEnabled } from "../../lib/moneygram-status";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useWallet } from "../WalletProvider";

type Row = RampSession & {
  balance: bigint | null;
  refreshing?: boolean;
  error?: string;
};

function dismissible(row: Row): boolean {
  if (row.balance !== 0n) return false;
  return (
    row.status === "completed" ||
    row.status === "shielded" ||
    row.status === "refunded" ||
    (row.kind === "cash-in" && row.status === "pending_user_transfer_start")
  );
}

function displayStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function displayAmount(amount: string): string {
  try {
    return `$${fromBaseUnits(BigInt(amount))}`;
  } catch {
    return "Amount unavailable";
  }
}

export function MoneyGramActivity() {
  const { getPrivySep10Signer } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!moneyGramCashInEnabled) return;
    const sessions = listRampSessions();
    setRows(
      await Promise.all(
        sessions.map(async (row) => ({
          ...row,
          balance: await bridgeUsdcBalance(row.publicKey).catch(() => null),
        })),
      ),
    );
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("olio:ramp-session", load);
    return () => window.removeEventListener("olio:ramp-session", load);
  }, [load]);
  if (!moneyGramCashInEnabled || rows.length === 0) return null;

  async function refresh(row: Row) {
    setRows((all) =>
      all.map((item) =>
        item.mgiId === row.mgiId
          ? { ...item, refreshing: true, error: undefined }
          : item,
      ),
    );
    try {
      if (row.kind === "cash-out" && !row.secret) {
        throw new Error("This terminal record no longer retains a bridge key.");
      }
      const info = await fetchAnchorInfo();
      const token = await authenticate(
        info,
        row.kind === "cash-in"
          ? getPrivySep10Signer()
          : Keypair.fromSecret(row.secret as string),
      );
      const tx = await getSep24Transaction(info, token, row.mgiId);
      const next = updateRampSession(row.mgiId, {
        status: row.status === "shielded" ? "shielded" : tx.status,
        externalTransactionId: tx.external_transaction_id,
        moreInfoUrl: tx.more_info_url,
        ...(tx.stellar_transaction_id
          ? { stellarHash: tx.stellar_transaction_id }
          : {}),
      });
      const balance = await bridgeUsdcBalance(row.publicKey);
      if (
        row.kind === "cash-out" &&
        tx.status === "completed" &&
        balance === 0n
      ) {
        clearPersistedBridge(row.mgiId);
        await load();
        return;
      }
      setRows((all) =>
        all.map((item) =>
          item.mgiId === row.mgiId
            ? { ...item, ...next, balance, refreshing: false }
            : item,
        ),
      );
    } catch (cause) {
      setRows((all) =>
        all.map((item) =>
          item.mgiId === row.mgiId
            ? {
                ...item,
                refreshing: false,
                error:
                  cause instanceof Error ? cause.message : "Refresh failed.",
              }
            : item,
        ),
      );
    }
  }

  return (
    <section
      aria-label="MoneyGram sandbox activity"
      className="mt-8 grid gap-4 border-t border-brand-linen/12 pt-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="font-heading text-xl font-semibold text-brand-linen">
            MoneyGram sandbox activity
          </h2>
          <p className="mt-1 text-sm text-brand-linen/60">
            Test sessions and certification evidence retained on this device.
          </p>
        </div>
        <span className="rounded-full border border-brand-linen/15 bg-brand-linen/8 px-3 py-1 text-xs font-semibold text-brand-linen/70">
          Sandbox only
        </span>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.mgiId}>
            <Card
              appearance="linen"
              density="comfortable"
              className="h-full min-h-64 justify-between gap-5"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {row.kind === "cash-in" ? "Cash in" : "Cash out"}
                    </p>
                    <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                      {displayAmount(row.amount)}
                    </p>
                    <p className="mt-1 text-sm font-medium text-muted-foreground">
                      USDC
                    </p>
                  </div>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-border">
                    {row.kind === "cash-in" ? (
                      <ArrowDownLeft className="size-5" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight className="size-5" aria-hidden="true" />
                    )}
                  </span>
                </div>

                <dl className="mt-5 grid gap-2 text-xs">
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="max-w-[65%] text-right font-semibold capitalize text-foreground">
                      {displayStatus(row.status)}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-muted-foreground">MGI ID</dt>
                    <dd className="break-all font-mono text-foreground/80">
                      {row.mgiId}
                    </dd>
                  </div>
                  {row.externalTransactionId ? (
                    <div className="grid gap-1">
                      <dt className="text-muted-foreground">Reference</dt>
                      <dd className="break-all font-mono text-foreground/80">
                        {row.externalTransactionId}
                      </dd>
                    </div>
                  ) : null}
                  {row.stellarHash ? (
                    <div className="grid gap-1">
                      <dt className="text-muted-foreground">Stellar</dt>
                      <dd className="break-all font-mono text-foreground/80">
                        {row.stellarHash}
                      </dd>
                    </div>
                  ) : null}
                  {row.shieldingHash ? (
                    <div className="grid gap-1">
                      <dt className="text-muted-foreground">Shielding</dt>
                      <dd className="break-all font-mono text-foreground/80">
                        {row.shieldingHash}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {row.balance && row.balance > 0n ? (
                  <p className="mt-4 rounded-xl bg-secondary px-3 py-2 text-xs font-medium text-foreground">
                    Returned or received USDC is ready in recovery.
                  </p>
                ) : null}
                {row.error ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
                  >
                    {row.error}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigator.clipboard?.writeText(row.mgiId)}
                >
                  <Copy className="size-3.5" /> Copy ID
                </Button>
                {row.moreInfoUrl ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    nativeButton={false}
                    render={
                      <a
                        href={row.moreInfoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <ExternalLink className="size-3.5" /> Status
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={row.refreshing || !row.secret}
                  onClick={() => refresh(row)}
                >
                  {row.refreshing ? (
                    <Loader className="size-3.5 motion-safe:animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}{" "}
                  Refresh
                </Button>
                {dismissible(row) ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      dismissRampSession(row.mgiId);
                      setRows((all) =>
                        all.filter((item) => item.mgiId !== row.mgiId),
                      );
                    }}
                  >
                    <Trash2 className="size-3.5" /> Dismiss
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
