"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { StrKey } from "@stellar/stellar-sdk";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenInsetClass } from "../ui/glass";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ToastFeedback } from "../ui/toast-feedback";

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
type RecoverySuccess = {
  amount: bigint;
  destination: string;
};

function shortKey(key: string): string {
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}

function formatUsd(units: bigint): string {
  return Number(fromBaseUnits(units)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function StrandedFundsRecovery({
  defaultDestination,
  className,
}: {
  defaultDestination?: string;
  className?: string;
}) {
  const hasDefaultDestination =
    !!defaultDestination && StrKey.isValidEd25519PublicKey(defaultDestination);
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState(false);
  const [editingDestination, setEditingDestination] = useState(
    !hasDefaultDestination,
  );
  const [success, setSuccess] = useState<RecoverySuccess | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RecoveryInput>({
    resolver: zodResolver(recoverySchema),
    defaultValues: {
      destination: hasDefaultDestination ? defaultDestination : "",
    },
  });

  const destination = watch("destination");

  const load = useCallback(async () => {
    const bridges = listStrandedBridges();
    setRows(bridges.map((bridge) => ({ ...bridge, balance: null })));
    const withBalances = await Promise.all(
      bridges.map(async (bridge) => ({
        ...bridge,
        balance: await bridgeUsdcBalance(bridge.publicKey).catch(() => null),
      })),
    );
    setRows(withBalances);
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    window.addEventListener("olio:ramp-session", load);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("olio:ramp-session", load);
    };
  }, [load]);

  useEffect(() => {
    if (!hasDefaultDestination || destination) return;
    setValue("destination", defaultDestination);
    setEditingDestination(false);
  }, [defaultDestination, destination, hasDefaultDestination, setValue]);

  const total = useMemo(() => {
    if (rows.length === 0 || rows.some((row) => row.balance === null)) {
      return null;
    }
    return rows.reduce((sum, row) => sum + (row.balance ?? 0n), 0n);
  }, [rows]);

  if (rows.length === 0 && !success) return null;

  async function reclaim(row: Row, nextDestination: string) {
    setRowError((errorsByRow) => ({ ...errorsByRow, [row.ref]: null }));
    setPending((pendingByRow) => ({ ...pendingByRow, [row.ref]: true }));
    try {
      const recovered = await reclaimBridge(row.secret, nextDestination);
      clearPersistedBridge(row.ref);
      setRows((currentRows) =>
        currentRows.filter((currentRow) => currentRow.ref !== row.ref),
      );
      setSuccess({
        amount: recovered.amount,
        destination: nextDestination,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Recovery failed.";
      setRowError((errorsByRow) => ({
        ...errorsByRow,
        [row.ref]: message,
      }));
    } finally {
      setPending((pendingByRow) => ({ ...pendingByRow, [row.ref]: false }));
    }
  }

  function dismiss(row: Row) {
    clearPersistedBridge(row.ref);
    setRows((currentRows) =>
      currentRows.filter((currentRow) => currentRow.ref !== row.ref),
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSuccess(null);
  }

  const currentWalletSelected =
    hasDefaultDestination && destination === defaultDestination;

  return (
    <>
      {total !== null && total > 0n ? (
        <section
          aria-label="Interrupted cash-out"
          className={cn(
            "group/recovery relative mb-5 flex min-h-64 flex-col justify-between gap-5 overflow-hidden rounded-2xl border border-warning-border bg-warning-surface p-5 [box-shadow:var(--shadow-md)] backdrop-blur-xl transition-colors duration-200 hover:border-warning-text/35 hover:bg-warning-surface/80 sm:p-6",
            className,
          )}
        >
          <div className="relative z-10 max-w-[62%]">
            <p className="type-caption uppercase text-warning-text/65">
              Recovery needed
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-brand-linen tabular-nums">
              {formatUsd(total)}
            </p>
          </div>

          <RecoverySketch />

          <p className="relative z-10 max-w-[20ch] text-sm leading-5 text-brand-linen/65">
            The payout didn&apos;t finish, but your funds are safe on a recovery
            account.
          </p>

          <Button
            type="button"
            variant="glass"
            className="relative z-10 w-full bg-warning-surface text-brand-linen ring-warning-border hover:bg-warning-surface/80"
            onClick={() => setOpen(true)}
          >
            Recover funds
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </section>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent appearance="linen" size="md">
          {success ? (
            <div className="grid justify-items-center gap-5 py-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700 ring-1 ring-emerald-600/25">
                <CheckCircle2 className="size-7" aria-hidden="true" />
              </span>
              <div>
                <DialogTitle className="text-xl text-foreground">
                  Funds recovered
                </DialogTitle>
                <DialogDescription className="mx-auto mt-2 max-w-[36ch] text-foreground/65">
                  {formatUsd(success.amount)} USDC is ready to claim in{" "}
                  {shortKey(success.destination)}.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="default"
                size="lg"
                className="w-full"
                onClick={() => {
                  if (rows.length > 0) {
                    setSuccess(null);
                  } else {
                    handleOpenChange(false);
                  }
                }}
              >
                {rows.length > 0 ? "Recover another" : "Done"}
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl text-foreground">
                  Recover your funds
                </DialogTitle>
                <DialogDescription className="leading-5 text-foreground/65">
                  Move the USDC from an interrupted cash-out to a Stellar wallet
                  you control.
                </DialogDescription>
              </DialogHeader>

              <div className={`${linenInsetClass} rounded-xl p-4`}>
                <p className="text-xs font-medium tracking-wide text-foreground/65 uppercase">
                  Recoverable
                </p>
                <p className="mt-1 font-mono text-3xl font-semibold text-foreground tabular-nums">
                  {total === null ? "…" : formatUsd(total)}
                </p>
                <p className="mt-1 text-xs text-foreground/65">
                  {rows.length} interrupted payout
                  {rows.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm text-foreground">
                    Destination wallet
                  </Label>
                  {!editingDestination && hasDefaultDestination ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-foreground/65 underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => setEditingDestination(true)}
                    >
                      Use another address
                    </button>
                  ) : null}
                </div>

                {!editingDestination && currentWalletSelected ? (
                  <div
                    className={`${linenInsetClass} flex items-center gap-3 p-3`}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
                      <Wallet className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        Current wallet
                      </p>
                      <p className="truncate font-mono text-xs text-foreground/65">
                        {shortKey(destination)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Input
                      id="recovery-destination"
                      appearance="linen"
                      placeholder="G…"
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={!!errors.destination}
                      {...register("destination")}
                    />
                    <ToastFeedback
                      message={errors.destination?.message}
                      variant="error"
                      toastId="recovery-destination-error"
                    />
                    {hasDefaultDestination ? (
                      <button
                        type="button"
                        className="w-fit text-xs font-semibold text-foreground/65 underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() => {
                          setValue("destination", defaultDestination, {
                            shouldValidate: true,
                          });
                          setEditingDestination(false);
                        }}
                      >
                        Use current wallet
                      </button>
                    ) : null}
                  </>
                )}
              </div>

              <ul className="grid gap-2">
                {rows.map((row) => {
                  const isPending = pending[row.ref];
                  const error = rowError[row.ref];
                  const empty = row.balance !== null && row.balance === 0n;
                  const amount =
                    row.balance === null ? null : formatUsd(row.balance);

                  return (
                    <li
                      key={row.ref}
                      className="grid gap-3 rounded-xl border border-foreground/12 bg-foreground/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs text-foreground/65">
                            Cash-out amount
                          </p>
                          <p className="flex items-center gap-2 font-mono text-base font-semibold text-foreground tabular-nums">
                            {amount === null && (
                              <Loader
                                className="size-4 motion-safe:animate-spin"
                                aria-hidden="true"
                              />
                            )}
                            {amount ?? "Checking…"}
                          </p>
                        </div>
                        <span className="text-xs text-foreground/65">
                          {empty ? "No funds found" : "Ready to recover"}
                        </span>
                      </div>

                      {row.destination ? (
                        <p className="text-xs text-foreground/65">
                          Originally headed to {shortKey(row.destination)}
                        </p>
                      ) : null}

                      <ToastFeedback
                        title="Recovery not completed"
                        message={error}
                        variant="error"
                        toastId={`recovery-error-${row.ref}`}
                        action={{
                          label: "Try again",
                          onClick: () =>
                            void handleSubmit((data) =>
                              reclaim(row, data.destination),
                            )(),
                        }}
                      />

                      {empty ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full text-foreground/65 hover:bg-foreground/8 hover:text-foreground"
                          onClick={() => dismiss(row)}
                        >
                          Remove recovered record
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="default"
                          size="lg"
                          className="w-full"
                          disabled={isPending || row.balance === null}
                          onClick={handleSubmit((data) =>
                            reclaim(row, data.destination),
                          )}
                        >
                          {isPending ? (
                            <Loader
                              className="size-4 motion-safe:animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <ArrowRight className="size-4" aria-hidden="true" />
                          )}
                          {isPending
                            ? "Recovering…"
                            : `Recover${amount ? ` ${amount} USDC` : " funds"}`}
                        </Button>
                      )}

                      <details className="group text-xs text-foreground/65">
                        <summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground/85">
                          Technical details
                        </summary>
                        <p className="mt-2 break-all font-mono">
                          Bridge account: {row.publicKey}
                        </p>
                      </details>
                    </li>
                  );
                })}
              </ul>

              <details
                className={`${linenInsetClass} px-3 py-2.5 text-xs text-foreground/65`}
              >
                <summary className="cursor-pointer font-semibold text-foreground/70">
                  How recovery works
                </summary>
                <p className="mt-2 leading-5">
                  Recovery creates a claimable USDC balance for the destination
                  wallet. The wallet can claim it when it is ready to receive
                  the asset.
                </p>
              </details>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecoverySketch() {
  return (
    <svg
      className="pointer-events-none absolute -right-2 top-7 h-32 w-40 overflow-visible text-brand-linen/75 transition-transform duration-500 ease-out motion-safe:group-hover/recovery:-rotate-2 motion-safe:group-hover/recovery:scale-[1.035]"
      viewBox="0 0 190 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M24 111C50 88 78 81 107 87C132 92 151 103 170 124"
        className="stroke-brand-linen/45 transition-transform duration-500 ease-out motion-safe:group-hover/recovery:translate-x-1 motion-safe:group-hover/recovery:-translate-y-1"
        strokeDasharray="6 9"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <g
        className="stroke-current transition-transform duration-500 ease-out motion-safe:group-hover/recovery:-translate-y-1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect
          x="35"
          y="35"
          width="76"
          height="82"
          rx="12"
          className="fill-brand-linen/5"
          strokeWidth="2"
          transform="rotate(-6 73 76)"
        />
        <path
          d="M54 58L91 54M53 75L96 71M52 92L80 89"
          className="stroke-brand-linen/45"
          strokeWidth="1.6"
          transform="rotate(-6 73 76)"
        />
      </g>
      <path
        d="M107 70H126M120 62L128 70L120 78"
        className="stroke-brand-linen/65 transition-transform duration-500 ease-out motion-safe:group-hover/recovery:translate-x-2"
        strokeDasharray="3 5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <g
        className="stroke-brand-linen transition-transform duration-500 ease-out motion-safe:group-hover/recovery:translate-x-1 motion-safe:group-hover/recovery:-translate-y-2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M134 70V58C134 46 142 38 154 38C166 38 174 46 174 58V70" />
        <rect
          x="127"
          y="68"
          width="54"
          height="42"
          rx="10"
          className="fill-brand-linen/5"
        />
        <circle cx="154" cy="85" r="3" />
        <path d="M154 88V96" />
      </g>
      <circle
        cx="27"
        cy="60"
        r="8"
        className="stroke-brand-linen/35"
        strokeWidth="1.4"
      />
    </svg>
  );
}
