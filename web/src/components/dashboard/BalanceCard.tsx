"use client";

import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Info,
  LockKeyhole,
  QrCode,
  ReceiptText,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const UPCOMING_STABLECOINS = ["EURC", "GYEN", "ZUSD", "AUDD"] as const;
const STABLECOIN_ASSETS = {
  USDC: "/stablecoins/usdc.svg",
  EURC: "/stablecoins/eurc.png",
  GYEN: "/stablecoins/gyen.png",
  ZUSD: "/stablecoins/zusd.png",
  AUDD: "/stablecoins/audd.png",
} as const;

function formatUsd(units: bigint): string {
  const amount = Number(fromBaseUnits(units));
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function LedgerMark() {
  return (
    <div className="relative flex size-11 shrink-0 rotate-[-3deg] items-center justify-center rounded-lg border border-white/20 bg-white/8 text-white shadow-sm">
      <ReceiptText className="size-5" aria-hidden="true" />
      <span className="absolute -right-1 -bottom-1 size-2.5 rounded-full border-2 border-ink/80 bg-white" />
    </div>
  );
}

export function BalanceCard({
  claimable,
  loading,
  locked = false,
  onUnlock,
  onReceive,
}: {
  claimable: bigint;
  loading: boolean;
  locked?: boolean;
  onUnlock?: () => void;
  onReceive?: () => void;
}) {
  const [balanceVisible, setBalanceVisible] = useState(true);

  if (locked) return <LockedBalanceCard onUnlock={onUnlock} />;

  return (
    <Card appearance="glass" className="gap-0 p-0">
      <div className="grid gap-7 p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/75">
              Your private balance
              <Info className="size-4 text-white/45" aria-hidden="true" />
            </div>
            {loading ? (
              <div className="h-11 w-36 rounded-lg bg-white/10 motion-safe:animate-pulse" />
            ) : (
              <div className="font-mono text-4xl font-semibold tracking-tight text-white tabular-nums sm:text-5xl">
                {balanceVisible ? formatUsd(claimable) : "••••••"}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="icon"
              variant="glass"
              className="size-11 shrink-0"
              onClick={() => setBalanceVisible((visible) => !visible)}
              aria-label={balanceVisible ? "Hide balance" : "Show balance"}
              aria-pressed={!balanceVisible}
              title={balanceVisible ? "Hide balance" : "Show balance"}
            >
              {balanceVisible ? (
                <Eye className="size-5" aria-hidden="true" />
              ) : (
                <EyeOff className="size-5" aria-hidden="true" />
              )}
            </Button>
            <Button
              size="icon"
              variant="glass"
              className="size-11 shrink-0"
              onClick={onReceive}
              disabled={!onReceive || loading}
              aria-label="Receive payment"
              title="Receive payment"
            >
              <QrCode className="size-5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="text-sm font-medium text-white/55">Tokens</div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="group flex min-h-16 w-full items-center gap-3 rounded-lg bg-white/7 p-3 text-left ring-1 ring-white/12 backdrop-blur-md transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Select token"
            >
              <LedgerMark />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-base font-semibold text-white tabular-nums">
                    {loading
                      ? "—"
                      : balanceVisible
                        ? fromBaseUnits(claimable)
                        : "••••"}
                  </span>
                  <span className="text-sm font-medium text-white/55">
                    USDC
                  </span>
                </div>
                <div className="text-sm text-white/45">Private USDC</div>
              </div>
              <div className="font-mono text-sm text-white/60 tabular-nums">
                {loading
                  ? "—"
                  : balanceVisible
                    ? formatUsd(claimable)
                    : "••••••"}
              </div>
              <ChevronDown
                className="size-4 shrink-0 text-white/55 transition-transform group-data-[popup-open]:rotate-180"
                aria-hidden="true"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              appearance="glass"
              align="end"
              sideOffset={8}
              className="min-w-72 p-2"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 pb-2 pt-1 text-xs font-semibold text-white/55">
                  Stellar Stablecoins
                </DropdownMenuLabel>
                <DropdownMenuItem className="min-h-12 gap-3 rounded-lg border border-white/12 bg-white/10 px-3 py-2 text-white outline-none focus:bg-white/14 focus:text-white focus:[&_svg]:text-white">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-white/20">
                    <Image
                      src={STABLECOIN_ASSETS.USDC}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6"
                    />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-semibold leading-none">USDC</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white/75 ring-1 ring-white/10">
                    <Check className="size-3" aria-hidden="true" />
                    Active
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-2 bg-white/12" />
                {UPCOMING_STABLECOINS.map((token) => (
                  <DropdownMenuItem
                    key={token}
                    disabled
                    className="min-h-12 gap-3 rounded-lg border border-white/8 bg-white/[0.05] px-3 py-2 text-white/70 opacity-100 outline-none data-disabled:pointer-events-none data-disabled:opacity-55"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/90 ring-1 ring-white/15">
                      <Image
                        src={STABLECOIN_ASSETS[token]}
                        alt=""
                        width={24}
                        height={24}
                        className="size-6"
                      />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="font-semibold leading-none">
                        {token}
                      </span>
                    </span>
                    <span className="rounded-md bg-white/[0.07] px-2 py-1 text-xs font-semibold text-white/45 ring-1 ring-white/8">
                      Coming soon
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

function LockedBalanceCard({ onUnlock }: { onUnlock?: () => void }) {
  return (
    <Card appearance="glass" className="gap-5 p-5 sm:p-7">
      <div className="flex size-11 items-center justify-center rounded-lg border border-white/15 bg-white/8 text-white">
        <LockKeyhole className="size-5" aria-hidden="true" />
      </div>
      <div className="grid gap-1">
        <div className="text-sm font-medium text-white/55">Private balance</div>
        <h2 className="font-heading text-xl font-semibold text-white">
          Balance locked
        </h2>
        <p className="text-sm text-white/55">Unlock to view your notes.</p>
      </div>
      <Button
        variant="glass"
        className="min-h-10 w-fit"
        onClick={onUnlock}
        disabled={!onUnlock}
      >
        Unlock with PIN
      </Button>
    </Card>
  );
}
