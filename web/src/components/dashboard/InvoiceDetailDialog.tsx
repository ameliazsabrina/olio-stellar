"use client";

import { Check, Copy, ExternalLink, Loader, Lock } from "lucide-react";
import { useState } from "react";
import {
  keyedItems,
  lineItemIdentity,
  type OpenedInvoice,
} from "../../features/invoices/invoiceContent";
import { storeManageToken } from "../../features/paymentLinks/manageTokens";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { fromBaseUnits } from "../../lib/crypto";
import { invoiceNumberLabel, keyToFragment } from "../../lib/invoiceCrypto";
import { payUrl } from "../../lib/paymentLinks";
import { explorerTxUrl } from "../../lib/stellar";
import type { RouterOutputs } from "../../server/root";
import { api } from "../../trpc/client";
import { trpc } from "../../trpc/react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenInsetClass } from "../ui/glass";
import { ToastFeedback } from "../ui/toast-feedback";
import { InvoiceStateBadge } from "./InvoiceStateBadge";

type InvoiceDetail = RouterOutputs["invoices"]["get"];
type InvoiceEvent = InvoiceDetail["events"][number];

const EVENT_LABELS: Record<InvoiceEvent["kind"], string> = {
  created: "Draft saved",
  issued: "Issued",
  revised: "Revised",
  cancelled: "Cancelled",
  allocation: "Payment applied",
  refund: "Refund recorded",
  erased: "Details erased",
};

const RAIL_LABELS = { direct: "Stellar", cctp: "Cross-chain", fiat: "Fiat" };

const usdc = (value: string) => `${fromBaseUnits(BigInt(value))} USDC`;

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
}

function slugFor(number: number): string {
  return `inv-${number.toString().padStart(4, "0")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function InvoiceDetailDialog({
  invoiceId,
  open,
  username,
  origin,
  opened,
  locked,
  links,
  onUnlock,
  onRevise,
  onLinkCreated,
  onOpenChange,
}: {
  invoiceId: string | null;
  open: boolean;
  username: string;
  origin: string;
  opened: OpenedInvoice | null;
  locked: boolean;
  links: PaymentLink[];
  onUnlock: () => void;
  onRevise: (detail: InvoiceDetail) => void;
  onLinkCreated: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.invoices.get.useQuery(
    { invoiceId: invoiceId ?? "" },
    { enabled: open && invoiceId !== null },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const invoice = detail.data;
  const label = invoice ? invoiceNumberLabel(invoice.number) : "Invoice";
  const payable =
    invoice?.state === "issued" || invoice?.state === "partially_paid";
  const link = links.find(
    (candidate) =>
      candidate.invoiceId === invoiceId && candidate.state === "active",
  );
  const linkUrl =
    link && opened && origin
      ? `${payUrl(origin, username, link.slug)}#${keyToFragment(opened.key)}`
      : "";
  const inFlight = (invoice?.intents ?? []).filter(
    (intent) => intent.state === "open" && intent.payerSentAt,
  );
  const hasAllocations = (invoice?.allocations ?? []).some(
    (allocation) => allocation.reversedAt === null,
  );

  async function refresh() {
    await Promise.all([
      utils.invoices.get.invalidate({ invoiceId: invoiceId ?? "" }),
      utils.invoices.list.invalidate(),
    ]);
  }

  async function run(name: string, action: () => Promise<unknown>) {
    setActionError(null);
    setBusy(name);
    try {
      await action();
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The action did not complete.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function createLink() {
    if (!invoice) return;
    await run("link", async () => {
      const { manageToken, ...created } = await api.paymentLinks.create.mutate({
        username,
        slug: slugFor(invoice.number),
        amount: fromBaseUnits(BigInt(invoice.remainingAmount)),
        description: `Invoice ${label}`,
        invoiceId: invoice.invoiceId,
      });
      storeManageToken(created.id, manageToken);
      await onLinkCreated();
    });
  }

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionError("Copy failed. Select the link and copy it manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{label}</DialogTitle>
            {invoice ? <InvoiceStateBadge state={invoice.state} /> : null}
          </div>
          <DialogDescription>
            {invoice
              ? `Version ${invoice.currentVersion} · ${
                  invoice.issuedAt
                    ? `Issued ${formatDate(invoice.issuedAt)}`
                    : "Not issued yet"
                } · Due ${formatDate(invoice.current.dueAt)}`
              : "Loading invoice details."}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading invoice"
            className="h-48 rounded-[1.5rem] bg-foreground/6 motion-safe:animate-pulse"
          />
        ) : detail.error ? (
          <ToastFeedback
            title="Could not load invoice"
            message={detail.error.message}
            variant="error"
            toastId="invoice-detail-error"
            action={{
              label: "Try again",
              onClick: () => void detail.refetch(),
            }}
          />
        ) : invoice ? (
          <div className="grid min-w-0 gap-5 text-sm">
            <section
              aria-labelledby="invoice-content-heading"
              className="grid min-w-0 gap-3"
            >
              <h3 id="invoice-content-heading" className="sr-only">
                Invoice details
              </h3>
              {invoice.erased ? (
                <p className="text-muted-foreground">
                  The encrypted details were erased. Amounts and the commitment
                  stay on record so issued evidence remains valid.
                </p>
              ) : opened ? (
                <>
                  <div className={`${linenInsetClass} grid gap-1 p-4`}>
                    <span className="font-semibold text-foreground">
                      {opened.content.customer.name}
                    </span>
                    {opened.content.customer.email ? (
                      <span className="text-muted-foreground">
                        {opened.content.customer.email}
                      </span>
                    ) : null}
                    {opened.content.customer.address ? (
                      <span className="whitespace-pre-line text-muted-foreground">
                        {opened.content.customer.address}
                      </span>
                    ) : null}
                  </div>
                  <ul className="divide-y divide-border">
                    {keyedItems(opened.content.lineItems, lineItemIdentity).map(
                      ({ key, item }) => (
                        <li
                          key={key}
                          className="flex items-start justify-between gap-3 py-2"
                        >
                          <span className="min-w-0 text-foreground">
                            {item.description}
                            <span className="block text-xs text-muted-foreground">
                              {item.quantity} × {usdc(item.unitPrice)}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-foreground">
                            {usdc(
                              (
                                BigInt(item.quantity) * BigInt(item.unitPrice)
                              ).toString(),
                            )}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                  {opened.content.notes ? (
                    <p className="whitespace-pre-line text-muted-foreground">
                      {opened.content.notes}
                    </p>
                  ) : null}
                </>
              ) : (
                <div
                  className={`${linenInsetClass} flex flex-wrap items-center justify-between gap-3 p-4`}
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Lock className="size-4" aria-hidden="true" />
                    {locked
                      ? "Unlock your account to read the encrypted details."
                      : "These details are encrypted to the business key and cannot be opened on this device."}
                  </span>
                  {locked ? (
                    <Button size="sm" variant="secondary" onClick={onUnlock}>
                      Unlock
                    </Button>
                  ) : null}
                </div>
              )}
            </section>

            <dl
              className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-border p-3"
              aria-label="Invoice amounts"
            >
              <dt className="text-muted-foreground">Amount due</dt>
              <dd className="text-right font-mono">
                {usdc(invoice.amountDue)}
              </dd>
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right font-mono">
                {usdc(invoice.paidAmount)}
              </dd>
              {invoice.refundedAmount !== "0" ? (
                <>
                  <dt className="text-muted-foreground">Refunded</dt>
                  <dd className="text-right font-mono">
                    {usdc(invoice.refundedAmount)}
                  </dd>
                </>
              ) : null}
              <dt className="font-semibold text-foreground">Remaining</dt>
              <dd className="text-right font-mono font-semibold text-foreground">
                {usdc(invoice.remainingAmount)}
              </dd>
            </dl>

            {payable && !invoice.erased ? (
              <section
                aria-labelledby="invoice-link-heading"
                className="grid min-w-0 gap-2"
              >
                <h3
                  id="invoice-link-heading"
                  className="font-semibold text-foreground"
                >
                  Payment link
                </h3>
                {linkUrl ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-foreground/6 px-3 py-2 font-mono text-xs">
                      {linkUrl.replace(/^https?:\/\//, "")}
                    </code>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={copyLink}
                      aria-label={copied ? "Link copied" : "Copy payment link"}
                    >
                      {copied ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                ) : link ? (
                  <p className="text-muted-foreground">
                    Unlock your account to rebuild the private link for this
                    invoice.
                  </p>
                ) : (
                  <Button
                    variant="secondary"
                    className="min-h-10 w-fit"
                    onClick={createLink}
                    disabled={busy !== null || !opened}
                    aria-busy={busy === "link"}
                  >
                    {busy === "link" ? (
                      <Loader
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Create payment link
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  The decryption key travels after the # in the link and is
                  never sent to Olio.
                </p>
              </section>
            ) : null}

            {inFlight.length > 0 ? (
              <p
                className={`${linenInsetClass} p-3 text-muted-foreground`}
                role="status"
              >
                {inFlight.length === 1
                  ? "A payer has sent funds from another chain. It counts once it settles in the pool."
                  : `${inFlight.length} cross-chain payments are on their way. They count once they settle in the pool.`}
              </p>
            ) : null}

            <section
              aria-labelledby="invoice-payments-heading"
              className="grid min-w-0 gap-2"
            >
              <h3
                id="invoice-payments-heading"
                className="font-semibold text-foreground"
              >
                Payments
              </h3>
              {invoice.allocations.length === 0 ? (
                <p className="text-muted-foreground">
                  No settled payments yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {invoice.allocations.map((allocation) => (
                    <li
                      key={allocation.allocationId}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-foreground">
                          {usdc(allocation.amount)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDate(allocation.ledgerClosedAt)}
                          {allocation.rail
                            ? ` · ${RAIL_LABELS[allocation.rail]}`
                            : ""}
                          {allocation.refundedAmount !== "0"
                            ? ` · ${usdc(allocation.refundedAmount)} refunded`
                            : ""}
                          {allocation.reversedAt ? " · not applied" : ""}
                        </span>
                      </span>
                      {allocation.txHash ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          nativeButton={false}
                          render={
                            <a
                              href={explorerTxUrl(allocation.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                          aria-label="View settlement transaction"
                          title="View settlement transaction"
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="invoice-history-heading"
              className="grid min-w-0 gap-2"
            >
              <h3
                id="invoice-history-heading"
                className="font-semibold text-foreground"
              >
                History
              </h3>
              <ol className="grid gap-1 text-muted-foreground">
                {keyedItems(
                  invoice.events,
                  (event) =>
                    `${event.at}:${event.kind}:${event.version ?? ""}:${event.settlementId ?? ""}`,
                ).map(({ key, item: event }) => (
                  <li key={key} className="flex justify-between gap-3">
                    <span>
                      {EVENT_LABELS[event.kind]}
                      {event.version ? ` · v${event.version}` : ""}
                    </span>
                    <span>{formatDate(event.at)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <ToastFeedback
              title="Invoice action not completed"
              message={actionError}
              variant="error"
              toastId="invoice-action-error"
            />

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {invoice.state === "draft" ? (
                <Button
                  onClick={() =>
                    run("issue", () =>
                      api.invoices.issue.mutate({
                        invoiceId: invoice.invoiceId,
                        expectedVersion: invoice.currentVersion,
                      }),
                    )
                  }
                  disabled={busy !== null}
                  aria-busy={busy === "issue"}
                >
                  Issue invoice
                </Button>
              ) : null}
              {(invoice.state === "draft" || invoice.state === "issued") &&
              !hasAllocations &&
              !invoice.erased ? (
                <Button
                  variant="secondary"
                  onClick={() => onRevise(invoice)}
                  disabled={busy !== null || !opened}
                >
                  Revise
                </Button>
              ) : null}
              {invoice.state === "draft" ||
              invoice.state === "issued" ||
              invoice.state === "partially_paid" ? (
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (
                      window.confirm(
                        `${invoice.state === "draft" ? "Void" : "Cancel"} ${label}? Payers can no longer start new payments for it.`,
                      )
                    )
                      void run("cancel", () =>
                        api.invoices.cancel.mutate({
                          invoiceId: invoice.invoiceId,
                        }),
                      );
                  }}
                  disabled={busy !== null}
                  aria-busy={busy === "cancel"}
                >
                  {invoice.state === "draft" ? "Void draft" : "Cancel invoice"}
                </Button>
              ) : null}
              {!invoice.erased ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Erase the customer details of ${label}? This cannot be undone. Amounts stay on record.`,
                      )
                    )
                      void run("erase", () =>
                        api.invoices.erase.mutate({
                          invoiceId: invoice.invoiceId,
                        }),
                      );
                  }}
                  disabled={busy !== null}
                  aria-busy={busy === "erase"}
                >
                  Erase details
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
