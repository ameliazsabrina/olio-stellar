"use client";

import { FileText, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type OpenedInvoice,
  openInvoice,
} from "../../features/invoices/invoiceContent";
import { usePaymentLinksByOwner } from "../../features/paymentLinks/hooks/usePaymentLink";
import { openVerification } from "../../features/verification/openVerification";
import { useVerification } from "../../features/verification/useVerification";
import { VERIFICATION_PATH } from "../../lib/auth-routes";
import { fromBaseUnits } from "../../lib/crypto";
import { invoiceNumberLabel } from "../../lib/invoiceCrypto";
import { getAccount } from "../../lib/notes";
import { cn } from "../../lib/utils";
import type { RouterOutputs } from "../../server/root";
import { trpc } from "../../trpc/react";
import { Button } from "../ui/button";
import { linenSegmentedClass } from "../ui/glass";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { DashboardTile } from "./DashboardTile";
import { InvoiceDetailDialog } from "./InvoiceDetailDialog";
import { InvoiceEditorDialog } from "./InvoiceEditorDialog";
import { InvoiceStateBadge } from "./InvoiceStateBadge";

type InvoiceSummary = RouterOutputs["invoices"]["list"]["items"][number];

const FILTERS = ["All", "Open", "Paid", "Drafts", "Closed"] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(invoice: InvoiceSummary, filter: Filter): boolean {
  if (filter === "Open")
    return invoice.state === "issued" || invoice.state === "partially_paid";
  if (filter === "Paid") return invoice.state === "paid";
  if (filter === "Drafts") return invoice.state === "draft";
  if (filter === "Closed")
    return invoice.state === "cancelled" || invoice.state === "void";
  return true;
}

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No due date";
}

export function InvoicesDashboard() {
  const { username, accountUnlocked, promptUnlock } = useWallet();
  const { business, businessesLoading } = useVerification();
  const businessId = business?.businessId ?? null;
  const canManage = business?.role === "owner" || business?.role === "admin";
  const invoices = trpc.invoices.list.useQuery(
    { businessId: businessId ?? "", limit: 100 },
    { enabled: businessId !== null },
  );
  const { links, refresh: refreshLinks } = usePaymentLinksByOwner(
    username ?? null,
  );
  const [filter, setFilter] = useState<Filter>("All");
  const [origin, setOrigin] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "revise"; invoice: InvoiceSummary } | null
  >(null);
  const [viewSk, setViewSk] = useState<Uint8Array | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setViewSk(accountUnlocked ? (getAccount()?.viewSk ?? null) : null);
  }, [accountUnlocked]);

  const items = invoices.data?.items ?? [];
  const opened = useMemo(() => {
    const map = new Map<string, OpenedInvoice | null>();
    for (const invoice of items)
      map.set(invoice.invoiceId, openInvoice(invoice.current, viewSk));
    return map;
  }, [items, viewSk]);
  const visible = items.filter((invoice) => matchesFilter(invoice, filter));
  const open = items.filter((invoice) => matchesFilter(invoice, "Open"));
  const outstanding = open.reduce(
    (sum, invoice) => sum + BigInt(invoice.remainingAmount),
    0n,
  );
  const loading =
    businessesLoading || (businessId !== null && invoices.isLoading);
  const editorInvoice = editor?.mode === "revise" ? editor.invoice : undefined;

  return (
    <>
      <DashboardPageHeader
        title="Invoices"
        description="Issue encrypted invoices and see each payment once it settles in the pool."
        action={
          <Button
            variant="glass"
            size="lg"
            onClick={() => setEditor({ mode: "create" })}
            disabled={!businessId || !canManage || !username}
          >
            <Plus className="size-4" aria-hidden="true" />
            New invoice
          </Button>
        }
      />

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 pb-16 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        <section
          className="min-w-0 md:col-span-2 lg:col-span-8"
          aria-labelledby="invoices-list-heading"
        >
          <DashboardTile
            appearance="linen"
            className="min-h-[19rem]"
            header={
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 id="invoices-list-heading" className="dashboard-tile-title">
                  All invoices
                </h2>
                <fieldset
                  className={cn(
                    linenSegmentedClass,
                    "grid w-full grid-cols-5 gap-1 p-1 sm:flex sm:w-fit",
                  )}
                >
                  <legend className="sr-only">Filter invoices</legend>
                  {FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={filter === option}
                      onClick={() => setFilter(option)}
                      className={cn(
                        "rounded-lg px-1.5 py-1.5 text-[13px] leading-[18px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
                        filter === option
                          ? "bg-foreground/18 text-foreground ring-1 ring-foreground/25"
                          : "text-foreground/65 hover:bg-foreground/8 hover:text-foreground",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </fieldset>
              </div>
            }
            content={
              <div className="mt-5">
                <ToastFeedback
                  title="Could not load invoices"
                  message={invoices.error?.message}
                  variant="error"
                  toastId="invoices-load-error"
                  action={{
                    label: "Try again",
                    onClick: () => void invoices.refetch(),
                  }}
                />
                {!accountUnlocked && items.length > 0 ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-foreground/6 px-3 py-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Lock className="size-4" aria-hidden="true" />
                      Customer details are encrypted. Unlock to read them.
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={promptUnlock}
                    >
                      Unlock
                    </Button>
                  </div>
                ) : null}
                {loading ? (
                  <div
                    className="grid gap-3"
                    role="status"
                    aria-busy="true"
                    aria-label="Loading invoices"
                  >
                    {[0, 1, 2].map((row) => (
                      <div
                        key={row}
                        className="h-16 rounded-lg bg-secondary motion-safe:animate-pulse"
                      />
                    ))}
                  </div>
                ) : !businessId ? (
                  <div className="grid gap-4">
                    <p className="max-w-md text-sm leading-6 text-muted-foreground">
                      Invoices are issued by a verified business. Complete
                      verification to start invoicing.
                    </p>
                    <Link
                      href={VERIFICATION_PATH}
                      onClick={(event) => {
                        event.preventDefault();
                        openVerification();
                      }}
                      className="inline-flex h-10 w-fit items-center rounded-full bg-foreground/8 px-4 text-sm font-semibold text-foreground ring-1 ring-foreground/15 hover:bg-foreground/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Go to verification
                    </Link>
                  </div>
                ) : visible.length === 0 ? (
                  <p className="py-5 text-sm text-muted-foreground">
                    {filter === "All"
                      ? "No invoices yet. Create one to send a private, verifiable request for payment."
                      : "No invoices match this filter."}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {visible.map((invoice) => {
                      const details = opened.get(invoice.invoiceId);
                      return (
                        <li key={invoice.invoiceId}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(invoice.invoiceId)}
                            className="flex min-h-16 w-full items-center gap-3 rounded-lg py-3 text-left transition-colors hover:bg-foreground/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-foreground">
                              <FileText className="size-5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {invoiceNumberLabel(invoice.number)}
                                </span>
                                <InvoiceStateBadge state={invoice.state} />
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {invoice.erased
                                  ? "Details erased"
                                  : (details?.content.customer.name ??
                                    "Encrypted details")}
                                {" · "}
                                {invoice.current.dueAt
                                  ? `Due ${formatDate(invoice.current.dueAt)}`
                                  : formatDate(null)}
                              </span>
                            </span>
                            <span className="shrink-0 text-right font-mono text-sm font-semibold text-foreground">
                              {fromBaseUnits(BigInt(invoice.amountDue))} USDC
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {invoices.data?.nextBeforeNumber ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing the latest 100 invoices.
                  </p>
                ) : null}
              </div>
            }
          />
        </section>

        <section
          className="min-w-0 md:col-span-2 lg:col-span-4"
          aria-labelledby="invoices-summary-heading"
        >
          <DashboardTile
            appearance="glass"
            className="min-h-[19rem] text-brand-linen"
            header={
              <h2
                id="invoices-summary-heading"
                className="dashboard-tile-title text-brand-linen"
              >
                Outstanding
              </h2>
            }
            content={
              <div className="mt-6 grid gap-2">
                {loading ? (
                  <div className="h-12 w-40 rounded-lg bg-brand-linen/12 motion-safe:animate-pulse" />
                ) : (
                  <p className="font-heading text-3xl font-semibold text-brand-linen">
                    {fromBaseUnits(outstanding)} USDC
                  </p>
                )}
                <p className="text-sm text-brand-linen/75">
                  {open.length === 1
                    ? "1 open invoice"
                    : `${open.length} open invoices`}
                </p>
              </div>
            }
            footer={
              <p className="text-xs text-brand-linen/75">
                An invoice counts as paid only after its payment settles in the
                pool. Payments sent from another chain show as on their way
                until then.
              </p>
            }
          />
        </section>
      </div>

      {businessId && username ? (
        <InvoiceEditorDialog
          mode={editor?.mode ?? "create"}
          open={editor !== null}
          businessId={businessId}
          username={username}
          invoice={editorInvoice}
          opened={
            editorInvoice ? (opened.get(editorInvoice.invoiceId) ?? null) : null
          }
          onOpenChange={(next) => {
            if (!next) setEditor(null);
          }}
          onSaved={async (saved) => {
            setEditor(null);
            await invoices.refetch();
            setSelectedId(saved.invoiceId);
          }}
        />
      ) : null}

      {username ? (
        <InvoiceDetailDialog
          invoiceId={selectedId}
          open={selectedId !== null && editor === null}
          username={username}
          origin={origin}
          opened={selectedId ? (opened.get(selectedId) ?? null) : null}
          locked={!accountUnlocked}
          links={links}
          onUnlock={promptUnlock}
          onRevise={(detail) => setEditor({ mode: "revise", invoice: detail })}
          onLinkCreated={() => refreshLinks()}
          onOpenChange={(next) => {
            if (!next) setSelectedId(null);
          }}
        />
      ) : null}
    </>
  );
}
