"use client";

import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LockKeyhole,
  QrCode,
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

const controlClass =
  "flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/45 text-primary-foreground ring-1 ring-border transition-colors hover:bg-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45";

export function BalanceCard({
  claimable,
  loading,
  locked = false,
  onUnlock,
  onReceive,
  onRefresh,
  refreshing = false,
  stale = false,
}: {
  claimable: bigint;
  loading: boolean;
  locked?: boolean;
  onUnlock?: () => void;
  onReceive?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  stale?: boolean;
}) {
  const [balanceVisible, setBalanceVisible] = useState(true);

  if (locked) {
    return (
      <DashboardTile
        appearance="linen"
        header={
          <div className="flex items-start justify-between gap-3">
            <h2 className="dashboard-tile-title">My Balance</h2>
            <LockKeyhole className="size-5 text-muted-foreground" />
          </div>
        }
        content={
          <p className="mt-5 text-sm leading-5 text-muted-foreground">
            Unlock your private notes to view this balance.
          </p>
        }
        footer={
          <button
            type="button"
            onClick={onUnlock}
            disabled={!onUnlock}
            className="rounded-full bg-brand-obsidian px-4 py-2 text-sm font-semibold text-brand-linen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-obsidian focus-visible:ring-offset-2"
          >
            Unlock with PIN
          </button>
        }
      />
    );
  }

  return (
    <DashboardTile
      appearance="linen"
      header={
        <div className="flex items-center gap-2">
          <h2 className="dashboard-tile-title">My Balance</h2>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!onRefresh || refreshing}
            className="rounded-full p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-obsidian"
            aria-label={
              refreshing
                ? "Updating balance"
                : stale
                  ? "Balance data is delayed. Retry"
                  : "Refresh balance"
            }
            title={refreshing ? "Updating balance…" : "Refresh balance"}
          >
            <RotateCw
              className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      }
      content={
        loading ? (
          <div className="mt-6 h-14 w-40 rounded-xl bg-brand-obsidian/8 motion-safe:animate-pulse" />
        ) : (
          <p className="mt-5 font-mono text-5xl font-semibold tracking-[-0.055em] text-foreground tabular-nums lg:text-[3.4rem]">
            {balanceVisible ? formatUsd(claimable) : "••••"}
          </p>
        )
      }
      footer={
        <div className="flex items-center gap-2">
          <CurrencySelector />
          <button
            type="button"
            className={controlClass}
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
          </button>
          <button
            type="button"
            className={controlClass}
            onClick={onReceive}
            disabled={!onReceive || loading}
            aria-label="Receive payment"
            title="Show receive QR code"
          >
            <QrCode className="size-5" aria-hidden="true" />
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
        className="group relative flex size-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground ring-2 ring-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Choose balance currency"
        title="Choose currency"
      >
        <Image
          src={STABLECOIN_ASSETS.USDC}
          alt=""
          width={30}
          height={30}
          className="size-8"
        />
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-1 ring-background">
          <ChevronDown
            className="size-3 transition-transform group-data-[popup-open]:rotate-180"
            aria-hidden="true"
          />
        </span>
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
