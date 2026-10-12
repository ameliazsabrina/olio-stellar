"use client";

import { BadgeCheck, Lock } from "lucide-react";
import Link from "next/link";
import { InvoiceStateBadge } from "../../../components/dashboard/InvoiceStateBadge";
import { Card } from "../../../components/ui/card";
import {
  keyedItems,
  lineItemIdentity,
} from "../../../features/invoices/invoiceContent";
import type { usePublicInvoice } from "../../../features/invoices/usePublicInvoice";
import { PUBLIC_BUSINESS_PATH } from "../../../lib/auth-routes";
import { fromBaseUnits } from "../../../lib/crypto";
import { invoiceNumberLabel } from "../../../lib/invoiceCrypto";

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
      <Card
        appearance="glass"
        density="spacious"
        className="gap-4"
        role="status"
        aria-busy="true"
        aria-label="Loading invoice"
      >
        <div className="h-6 w-40 rounded-lg bg-brand-linen/12 motion-safe:animate-pulse" />
        <div className="h-24 rounded-xl bg-brand-linen/8 motion-safe:animate-pulse" />
      </Card>
    );
  }
  if (!invoice) {
    return (
      <Card appearance="glass" className="gap-3 p-6">
        <h2 className="text-lg font-semibold text-brand-linen">
          Invoice unavailable
        </h2>
        <p className="text-sm text-brand-linen/60">
          This invoice may have been voided or the link is incomplete.
        </p>
      </Card>
    );
  }

  return (
    <Card appearance="glass" density="spacious" className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-product-panel-title text-brand-linen">
          Invoice {invoiceNumberLabel(invoice.number)}
        </h2>
        <InvoiceStateBadge state={invoice.state} appearance="glass" />
      </div>

      {invoice.business.displayName || invoice.business.verifiedPublicId ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-brand-linen/70">
          <span>From {invoice.business.displayName ?? "this business"}</span>
          {invoice.business.verifiedPublicId ? (
            <Link
              href={`${PUBLIC_BUSINESS_PATH}/${invoice.business.verifiedPublicId}`}
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              <BadgeCheck className="size-4" aria-hidden="true" />
              Verified business
            </Link>
          ) : null}
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
          <ul className="divide-y divide-brand-linen/15 rounded-xl border border-brand-linen/15 px-3">
            {keyedItems(content.lineItems, lineItemIdentity).map(
              ({ key, item }) => (
                <li
                  key={key}
                  className="flex items-start justify-between gap-3 py-2 text-brand-linen/80"
                >
                  <span className="min-w-0">
                    {item.description}
                    <span className="block text-xs text-brand-linen/55">
                      {item.quantity} × {usdc(item.unitPrice)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono">
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
        className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-brand-linen/15 p-3 text-sm text-brand-linen/75"
        aria-label="Invoice amounts"
      >
        <dt>Amount due</dt>
        <dd className="text-right">{usdc(invoice.amountDue)}</dd>
        {invoice.dueAt ? (
          <>
            <dt>Due</dt>
            <dd className="text-right">{formatDate(invoice.dueAt)}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-brand-linen">Remaining</dt>
        <dd className="text-right font-semibold text-brand-linen">
          {usdc(invoice.remainingAmount)}
        </dd>
      </dl>

      {!invoice.payable ? (
        <p className="text-sm text-brand-linen/65" role="status">
          {invoice.state === "paid"
            ? "This invoice is paid in full."
            : "This invoice is no longer open for payment."}
        </p>
      ) : null}
    </Card>
  );
}
