"use client";

import { Lock } from "lucide-react";
import { DashboardTile } from "../../../components/dashboard/DashboardTile";
import { InvoiceStateBadge } from "../../../components/dashboard/InvoiceStateBadge";
import {
  keyedItems,
  lineItemIdentity,
} from "../../../features/invoices/invoiceContent";
import type { usePublicInvoice } from "../../../features/invoices/usePublicInvoice";
import { fromBaseUnits } from "../../../lib/crypto";
import { invoiceNumberLabel } from "../../../lib/invoiceCrypto";
import { PayNotice } from "./PayStates";

type PublicInvoiceState = ReturnType<typeof usePublicInvoice>;

const usdc = (value: string | bigint) => `${fromBaseUnits(BigInt(value))} USDC`;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function InvoicePaySummary({ view }: { view: PublicInvoiceState }) {
  const { invoice, content, keyPresent, mismatch, loading } = view;

  if (loading) {
    return (
      <div
        className="grid gap-4 rounded-[1.75rem] bg-brand-linen/8 p-6 ring-1 ring-brand-linen/15 motion-safe:animate-pulse"
        role="status"
        aria-busy="true"
        aria-label="Loading invoice"
      >
        <div className="h-6 w-40 rounded-lg bg-brand-linen/12" />
        <div className="h-24 rounded-xl bg-brand-linen/8" />
      </div>
    );
  }
  if (!invoice) {
    return (
      <PayNotice title="Invoice unavailable">
        This invoice may have been voided or the link is incomplete.
      </PayNotice>
    );
  }

  return (
    <DashboardTile
      appearance="glass"
      className="min-h-0 text-brand-linen"
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="dashboard-tile-title">
            Invoice {invoiceNumberLabel(invoice.number)}
          </h2>
          <InvoiceStateBadge state={invoice.state} appearance="glass" />
        </div>
      }
      content={
        <div className="mt-5 grid gap-5">
          {invoice.business.displayName ? (
            <p className="text-sm text-brand-linen/70">
              From {invoice.business.displayName}
            </p>
          ) : null}

          {content ? (
            <div className="grid gap-3 text-sm">
              <p className="text-brand-linen/70">
                Billed to{" "}
                <span className="font-semibold text-brand-linen">
                  {content.customer.name}
                </span>
              </p>
              <ul className="divide-y divide-brand-linen/15 border-y border-brand-linen/15">
                {keyedItems(content.lineItems, lineItemIdentity).map(
                  ({ key, item }) => (
                    <li
                      key={key}
                      className="flex items-start justify-between gap-3 py-2 text-brand-linen/80"
                    >
                      <span className="min-w-0">
                        {item.description}
                        <span className="block text-xs text-brand-linen/70">
                          {item.quantity} × {usdc(item.unitPrice)}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {usdc(BigInt(item.quantity) * BigInt(item.unitPrice))}
                      </span>
                    </li>
                  ),
                )}
              </ul>
              {content.notes ? (
                <p className="whitespace-pre-line text-brand-linen/65">
                  {content.notes}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="flex items-start gap-2 text-sm text-brand-linen/65">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {mismatch
                ? "The invoice details could not be verified against what was issued. Ask the sender for a fresh link before paying."
                : keyPresent
                  ? "The invoice details are no longer available."
                  : "This link is missing its private key, so the line items stay encrypted. Ask the sender for the full link."}
            </p>
          )}

          <dl
            className="grid divide-y divide-brand-linen/15 text-[0.8125rem] leading-[1.125rem]"
            aria-label="Invoice amounts"
          >
            <div className="flex items-center justify-between gap-4 py-2">
              <dt className="text-brand-linen/70">Amount due</dt>
              <dd className="font-semibold tabular-nums">
                {usdc(invoice.amountDue)}
              </dd>
            </div>
            {invoice.dueAt ? (
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-brand-linen/70">Due</dt>
                <dd className="font-semibold">{formatDate(invoice.dueAt)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 pt-3">
              <dt className="font-semibold">Remaining</dt>
              <dd className="text-2xl leading-[1.875rem] font-semibold tracking-[-0.0125em] tabular-nums">
                {usdc(invoice.remainingAmount)}
              </dd>
            </div>
          </dl>

          {!invoice.payable ? (
            <p className="text-sm text-brand-linen/70" role="status">
              {invoice.state === "paid"
                ? "This invoice is paid in full."
                : "This invoice is no longer open for payment."}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
