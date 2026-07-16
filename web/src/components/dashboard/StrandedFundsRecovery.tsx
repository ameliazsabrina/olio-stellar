"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { StrKey } from "@stellar/stellar-sdk";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  bridgeUsdcBalance,
  clearPersistedBridge,
  listStrandedBridges,
  reclaimBridge,
  type StrandedBridge,
} from "../../lib/bridge";
import { fromBaseUnits } from "../../lib/crypto";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const recoverySchema = z.object({
  destination: z
    .string()
    .trim()
    .refine(
      (s) => StrKey.isValidEd25519PublicKey(s),
      "Enter a Stellar account address that starts with G.",
    ),
});

type RecoveryInput = z.infer<typeof recoverySchema>;

type Row = StrandedBridge & { balance: bigint | null };

function shortKey(key: string): string {
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}

export function StrandedFundsRecovery({
  defaultDestination,
}: {
  defaultDestination?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RecoveryInput>({
    resolver: zodResolver(recoverySchema),
    defaultValues: {
      destination:
        defaultDestination && StrKey.isValidEd25519PublicKey(defaultDestination)
          ? defaultDestination
          : "",
    },
  });

  const load = useCallback(async () => {
    const bridges = listStrandedBridges();
    setRows(bridges.map((b) => ({ ...b, balance: null })));
    const withBalances = await Promise.all(
      bridges.map(async (b) => ({
        ...b,
        balance: await bridgeUsdcBalance(b.publicKey).catch(() => null),
      })),
    );
    setRows(withBalances);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows.length === 0) return null;

  async function reclaim(row: Row, destination: string) {
    setRowError((e) => ({ ...e, [row.ref]: null }));
    setPending((p) => ({ ...p, [row.ref]: true }));
    try {
      await reclaimBridge(row.secret, destination);
      clearPersistedBridge(row.ref);
      setRows((rs) => rs.filter((r) => r.ref !== row.ref));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recovery failed.";
      setRowError((e) => ({ ...e, [row.ref]: msg }));
    } finally {
      setPending((p) => ({ ...p, [row.ref]: false }));
    }
  }

  function dismiss(row: Row) {
    clearPersistedBridge(row.ref);
    setRows((rs) => rs.filter((r) => r.ref !== row.ref));
  }

  return (
    <Card appearance="glass" className="mb-5 gap-4 border-amber-400/30 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-white">
            Recover interrupted cash-outs
          </h2>
          <p className="text-sm text-white/65">
            {rows.length} payout{rows.length === 1 ? "" : "s"} left the shielded
            pool but never reached their destination. Send them to a Stellar
            account you control — they claim it as a claimable balance.
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="recovery-destination" className="text-sm text-white">
          Destination account
        </Label>
        <Input
          id="recovery-destination"
          placeholder="G…"
          spellCheck={false}
          autoComplete="off"
          {...register("destination")}
        />
        {errors.destination ? (
          <p className="text-xs text-red-300">{errors.destination.message}</p>
        ) : null}
      </div>

      <ul className="grid gap-2">
        {rows.map((row) => {
          const isPending = pending[row.ref];
          const err = rowError[row.ref];
          const live = row.balance;
          const empty = live !== null && live === 0n;
          return (
            <li
              key={row.ref}
              className="grid gap-2 rounded-lg border border-white/12 bg-white/5 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-white/55">
                  {shortKey(row.publicKey)}
                </span>
                <span className="font-mono text-sm font-semibold text-white tabular-nums">
                  {live === null ? "…" : `${fromBaseUnits(live)} USDC`}
                </span>
              </div>
              {row.destination ? (
                <p className="text-xs text-white/45">
                  Was headed to {shortKey(row.destination)}
                </p>
              ) : null}
              {err ? <p className="text-xs text-red-300">{err}</p> : null}
              <div>
                {empty ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismiss(row)}
                  >
                    Already recovered — dismiss
                  </Button>
                ) : (
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={isPending}
                    onClick={handleSubmit((data) =>
                      reclaim(row, data.destination),
                    )}
                  >
                    {isPending ? (
                      <Loader2
                        className="size-4 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight className="size-4" aria-hidden="true" />
                    )}
                    Reclaim
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
