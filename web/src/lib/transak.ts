"use client";

import type { Memo } from "@stellar/stellar-sdk";
import { buildMemoFrom } from "./anchor";
import { isMainnet } from "./stellar";

export const transakApiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY || "";

export const transakEnvironment: "STAGING" | "PRODUCTION" =
  (process.env.NEXT_PUBLIC_TRANSAK_ENV || "PRODUCTION").toUpperCase() ===
  "STAGING"
    ? "STAGING"
    : "PRODUCTION";

export const transakFiatCurrency =
  process.env.NEXT_PUBLIC_TRANSAK_FIAT_CURRENCY || "";

export const transakEnabled = Boolean(transakApiKey) && isMainnet;

export type TransakOrder = {
  id?: string;
  status?: string;
  cryptoAddress?: string;
  cryptoMemo?: string;
  cryptoMemoType?: "text" | "id";
  cryptoAmount?: string;
};

export function hasDepositInstructions(o: TransakOrder): boolean {
  return Boolean(o.cryptoAddress);
}

export function isCompleted(o: TransakOrder): boolean {
  const s = (o.status || "").toUpperCase();
  return s === "COMPLETED" || s === "ORDER_COMPLETED";
}

export function transakMemo(o: TransakOrder): Memo | undefined {
  return buildMemoFrom(o.cryptoMemo, o.cryptoMemoType);
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0
    ? v
    : typeof v === "number"
      ? String(v)
      : undefined;

function normalizeOrder(data: unknown): TransakOrder {
  const root = record(data);
  const order = record(root.status ?? root.orderData ?? root);
  const payment = record(order.cryptoPaymentData);
  const addresses = Array.isArray(payment.paymentAddresses)
    ? payment.paymentAddresses
    : [];
  const first = record(addresses[0]);

  const cryptoAddress =
    str(first.address) ??
    str(payment.paymentAddress) ??
    str(order.depositAddress) ??
    str(root.walletAddress) ??
    str(order.walletAddress);

  const cryptoMemo =
    str(first.memo) ??
    str(first.destinationTag) ??
    str(payment.memo) ??
    str(order.depositMemo);

  return {
    id: str(order.id) ?? str(root.id),
    status: str(order.status) ?? str(root.status),
    cryptoAddress,
    cryptoMemo,
    cryptoMemoType: cryptoMemo && /^\d+$/.test(cryptoMemo) ? "id" : "text",
    cryptoAmount: str(order.cryptoAmount) ?? str(root.cryptoAmount),
  };
}

type Waiter = {
  until: (o: TransakOrder) => boolean;
  resolve: (o: TransakOrder) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type TransakSession = {
  until: (
    until: (o: TransakOrder) => boolean,
    opts?: { timeoutMs?: number },
  ) => Promise<TransakOrder>;
  close: () => void;
};

export async function openTransakOffRamp(params: {
  walletAddress: string;
  cryptoAmount: string;
  fiatCurrency?: string;
}): Promise<TransakSession> {
  if (!transakApiKey) {
    throw new Error("Transak is not configured (missing API key).");
  }

  const { Transak } = await import("@transak/ui-js-sdk");

  let latest: TransakOrder = {};
  const waiters = new Set<Waiter>();
  let disposed = false;

  const settle = () => {
    for (const w of [...waiters]) {
      if (w.until(latest)) {
        clearTimeout(w.timer);
        waiters.delete(w);
        w.resolve(latest);
      }
    }
  };

  const failAll = (message: string) => {
    for (const w of [...waiters]) {
      clearTimeout(w.timer);
      waiters.delete(w);
      w.reject(new Error(message));
    }
  };

  const fiat = params.fiatCurrency || transakFiatCurrency;
  const config = {
    apiKey: transakApiKey,
    environment: transakEnvironment,
    productsAvailed: "SELL",
    cryptoCurrencyCode: "USDC",
    network: "stellar",
    walletAddress: params.walletAddress,
    cryptoAmount: Number(params.cryptoAmount),
    disableWalletAddressForm: true,
    ...(fiat ? { fiatCurrency: fiat } : {}),
  };

  const transak = new Transak(
    config as unknown as ConstructorParameters<typeof Transak>[0],
  );

  const onOrder = (data: unknown) => {
    if (disposed) return;
    latest = { ...latest, ...normalizeOrder(data) };
    settle();
  };
  const onClose = () => {
    if (disposed) return;
    failAll("Transak window was closed before the cash-out completed.");
  };
  const onFail = (data: unknown) => {
    if (disposed) return;
    latest = { ...latest, ...normalizeOrder(data) };
    failAll("Transak could not complete the cash-out.");
  };

  Transak.on(Transak.EVENTS.TRANSAK_ORDER_CREATED, onOrder);
  Transak.on(Transak.EVENTS.TRANSAK_WALLET_REDIRECTION, onOrder);
  Transak.on(Transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL, onOrder);
  Transak.on(Transak.EVENTS.TRANSAK_ORDER_FAILED, onFail);
  Transak.on(Transak.EVENTS.TRANSAK_ORDER_CANCELLED, onFail);
  Transak.on(Transak.EVENTS.TRANSAK_WIDGET_CLOSE, onClose);

  transak.init();

  return {
    until: (until, { timeoutMs = 15 * 60_000 } = {}) =>
      new Promise<TransakOrder>((resolve, reject) => {
        if (disposed) {
          reject(new Error("Transak session is closed."));
          return;
        }
        if (until(latest)) {
          resolve(latest);
          return;
        }
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Timed out waiting for Transak."));
        }, timeoutMs);
        const waiter: Waiter = { until, resolve, reject, timer };
        waiters.add(waiter);
      }),
    close: () => {
      if (disposed) return;
      disposed = true;
      failAll("Transak session is closed.");
      try {
        transak.close();
      } catch {}
      try {
        transak.cleanup();
      } catch {}
    },
  };
}

export function pollTransakOrderUntil(
  session: TransakSession,
  until: (o: TransakOrder) => boolean,
  opts?: { timeoutMs?: number },
): Promise<TransakOrder> {
  return session.until(until, opts);
}
