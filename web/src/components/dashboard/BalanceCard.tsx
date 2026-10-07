"use client";

import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LockKeyhole,
  RotateCw,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { fromBaseUnits } from "../../lib/crypto";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { DashboardTile } from "./DashboardTile";

const UPCOMING_STABLECOINS = ["EURC", "GYEN", "ZUSD", "AUDD"] as const;
const STABLECOIN_ASSETS = {
  USDC: "/stablecoins/usdc.svg",
  EURC: "/stablecoins/eurc.png",
  GYEN: "/stablecoins/gyen.png",
  ZUSD: "/stablecoins/zusd.png",
  AUDD: "/stablecoins/audd.png",
} as const;

function formatUsd(units: bigint): string {
  return Number(fromBaseUnits(units)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

const tintControlClass =
  "flex shrink-0 items-center justify-center rounded-full bg-(--hero-tint) text-(--hero-foreground) transition-colors hover:bg-(--hero-tint)/80 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--hero-foreground) disabled:cursor-not-allowed disabled:opacity-45";

export function checkedAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "Not checked yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Not checked yet";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  return `Checked ${Math.floor(hours / 24)}d ago`;
}

export function BalanceCard({
  claimable,
  loading,
  locked = false,
  onUnlock,
  onRefresh,
  refreshing = false,
  stale = false,
  indexedAt = null,
  amountsHidden,
  onToggleAmounts,
}: {
  claimable: bigint;
  loading: boolean;
  locked?: boolean;
  onUnlock?: () => void;
  onReceive?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  stale?: boolean;
  indexedAt?: string | null;
  amountsHidden?: boolean;
  onToggleAmounts?: () => void;
}) {
  const [hiddenLocally, setHiddenLocally] = useState(false);
  const balanceVisible = !(amountsHidden ?? hiddenLocally);
  const toggleAmounts =
    onToggleAmounts ?? (() => setHiddenLocally((hidden) => !hidden));

  if (locked) {
    return (
      <DashboardTile
        appearance="hero"
        className="justify-between"
        header={
          <div className="flex h-10 items-center justify-between gap-3">
            <h2 className="dashboard-tile-title">My balance</h2>
            <LockKeyhole className="size-5 opacity-80" aria-hidden="true" />
          </div>
        }
        content={
          <p className="mt-3 text-[0.8125rem] leading-[1.1875rem] text-(--hero-soft)">
            Unlock with your PIN to see your private balance.
          </p>
        }
        footer={
          <button
            type="button"
            onClick={onUnlock}
            disabled={!onUnlock}
            className="min-h-10 rounded-xl bg-(--hero-foreground) px-4 text-sm font-medium text-brand-obsidian [[data-dashboard-theme=dark]_&]:text-brand-linen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--hero-foreground) focus-visible:ring-offset-2"
          >
            Unlock with PIN
          </button>
        }
      />
    );
  }

  const status = refreshing
    ? "Checking for new payments…"
    : stale
      ? "Couldn't refresh. Showing the last check."
      : checkedAgo(indexedAt);

  return (
    <DashboardTile
      appearance="hero"
      header={
        <div className="flex h-10 items-center justify-between gap-3">
          <h2 className="dashboard-tile-title">My balance</h2>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!onRefresh || refreshing}
            className={`${tintControlClass} size-8`}
            aria-label={
              refreshing
                ? "Updating balance"
                : stale
                  ? "Balance data is delayed. Retry"
                  : "Refresh balance"
            }
            title={refreshing ? "Updating balance…" : "Rescan"}
          >
            <RotateCw
              className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      }
      content={
        <div className="mt-3.5 grid gap-3.5">
          {loading ? (
            <div className="h-9 w-44 rounded-lg bg-(--hero-tint) motion-safe:animate-pulse" />
          ) : (
            <p className="font-mono text-[1.875rem] leading-9 font-bold text-(--hero-foreground) tabular-nums">
              {balanceVisible ? formatUsd(claimable) : "••••••"}
            </p>
          )}
          <p
            className="text-[0.8125rem] leading-[1.1875rem] text-(--hero-soft)"
            aria-live="polite"
          >
            {status}
          </p>
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          <CurrencySelector />
          <button
            type="button"
            className={`${tintControlClass} size-10`}
            onClick={toggleAmounts}
            aria-label={balanceVisible ? "Hide amounts" : "Show amounts"}
            aria-pressed={!balanceVisible}
            title={balanceVisible ? "Hide amounts" : "Show amounts"}
          >
            {balanceVisible ? (
              <Eye className="size-[1.125rem]" aria-hidden="true" />
            ) : (
              <EyeOff className="size-[1.125rem]" aria-hidden="true" />
            )}
          </button>
        </div>
      }
    />
  );
}

function CurrencySelector() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-(--hero-tint) pr-3 pl-2.5 text-[0.8125rem] font-semibold text-(--hero-foreground) transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--hero-foreground)"
        aria-label="Choose balance currency"
        title="Choose currency"
      >
        <Image
          src={STABLECOIN_ASSETS.USDC}
          alt=""
          width={18}
          height={18}
          className="size-[1.125rem]"
        />
        USDC
        <ChevronDown
          className="size-3.5 opacity-75 transition-transform group-data-[popup-open]:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        appearance="glass"
        align="start"
        sideOffset={10}
        className="min-w-64 p-2"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1 pb-2 text-xs font-semibold text-brand-linen/65">
            Stellar stablecoins
          </DropdownMenuLabel>
          <DropdownMenuItem className="min-h-12 gap-3 rounded-lg bg-brand-linen/12 px-3 py-2 text-brand-linen focus:bg-brand-linen/18 focus:text-brand-linen [&_svg]:text-brand-linen">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-linen">
              <Image
                src={STABLECOIN_ASSETS.USDC}
                alt=""
                width={24}
                height={24}
                className="size-6"
              />
            </span>
            <span className="min-w-0 flex-1 font-semibold">USDC</span>
            <span className="inline-flex items-center gap-1 text-xs text-brand-linen/70">
              <Check className="size-3" aria-hidden="true" /> Active
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-2 bg-brand-linen/12" />
          {UPCOMING_STABLECOINS.map((currency) => (
            <DropdownMenuItem
              key={currency}
              disabled
              className="min-h-11 gap-3 rounded-lg px-3 py-2 text-brand-linen/55 opacity-100 data-disabled:pointer-events-none data-disabled:opacity-55"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-linen/90">
                <Image
                  src={STABLECOIN_ASSETS[currency]}
                  alt=""
                  width={24}
                  height={24}
                  className="size-6"
                />
              </span>
              <span className="min-w-0 flex-1 font-semibold">{currency}</span>
              <span className="text-xs">Coming soon</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
