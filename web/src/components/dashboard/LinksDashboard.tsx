"use client";

import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  ExternalLink,
  Loader,
  Pencil,
  Plus,
  QrCode,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePaymentLinksByOwner } from "../../features/paymentLinks/hooks/usePaymentLink";
import {
  getManageToken,
  removeManageToken,
} from "../../features/paymentLinks/manageTokens";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { fromBaseUnits } from "../../lib/crypto";
import { payUrl } from "../../lib/paymentLinks";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ToastFeedback } from "../ui/toast-feedback";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { LinkEditorDialog } from "./LinkEditorDialog";
import { PaymentQrDialog } from "./PaymentQrDialog";
import { PersonalLinkCard } from "./PersonalLinkCard";

function displayAmount(link: PaymentLink) {
  return link.amount
    ? `${fromBaseUnits(BigInt(link.amount))} USDC`
    : "Open amount";
}

function isUnauthorized(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { data?: { code?: string } }).data?.code === "UNAUTHORIZED"
  );
}

export function LinksDashboard({
  username,
  origin,
}: {
  username: string;
  origin: string;
}) {
  const { links, loading, error, refresh, setLinks } =
    usePaymentLinksByOwner(username);
  const [createOpen, setCreateOpen] = useState(false);
  const payLink = username && origin ? `${origin}/pay/${username}` : "";

  async function replaceLink(next: PaymentLink) {
    setLinks((current) =>
      current.map((link) => (link.id === next.id ? next : link)),
    );
  }

  return (
    <>
      <DashboardPageHeader
        title="Links"
        description={
          <>
            Create and manage payment links for invoices, tips, projects, and
            open-ended requests.
          </>
        }
        action={
          <Button variant="glass" size="lg" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Create link
          </Button>
        }
      />

      <section className="grid gap-4" aria-label="Payment links">
        <ToastFeedback
          title="Could not load payment links"
          message={error}
          variant="error"
          toastId="payment-links-load-error"
          action={{ label: "Try again", onClick: () => void refresh() }}
        />
        {(loading || links.length > 0) && (
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-xl font-semibold text-brand-linen">
              Payment links
            </h2>
            <span className="flex items-center gap-2 text-sm text-brand-linen/60">
              {loading && (
                <Loader
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {loading ? "Loading..." : `${links.length + 1} total`}
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PersonalLinkCard username={username} payLink={payLink} />
          {loading ? (
            <div
              className="min-h-64 rounded-[1.625rem] bg-brand-linen ring-1 ring-brand-obsidian/10 motion-safe:animate-pulse"
              aria-hidden="true"
            />
          ) : null}
          {links.map((link) => (
            <GeneratedLinkCard
              key={link.id}
              link={link}
              username={username}
              origin={origin}
              onChanged={replaceLink}
              onDeleted={refresh}
            />
          ))}
        </div>
      </section>

      <LinkEditorDialog
        mode="create"
        open={createOpen}
        username={username}
        onOpenChange={setCreateOpen}
        onSaved={async () => {
          setCreateOpen(false);
          await refresh();
        }}
      />
    </>
  );
}

function GeneratedLinkCard({
  link,
  username,
  origin,
  onChanged,
  onDeleted,
}: {
  link: PaymentLink;
  username: string;
  origin: string;
  onChanged: (link: PaymentLink) => void;
  onDeleted: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<
    { kind: "archive"; nextArchived: boolean } | { kind: "delete" } | null
  >(null);
  const [manageToken, setManageToken] = useState<string | null>(null);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const url = payUrl(origin, username, link.slug);
  const archived = link.state === "archived";
  const canManage = manageToken !== null;
  const manageTitle = canManage
    ? undefined
    : "Only available on the device that created this link";

  // Read from localStorage after mount to avoid an SSR/hydration mismatch.
  useEffect(() => {
    setManageToken(getManageToken(link.id));
  }, [link.id]);

  async function copy() {
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function archive(nextArchived: boolean) {
    if (!manageToken) return;
    setActionError(null);
    setFailedAction(null);
    setBusy(true);
    try {
      onChanged(
        await api.paymentLinks.setArchived.mutate({
          id: link.id,
          manageToken,
          archived: nextArchived,
        }),
      );
    } catch (e) {
      if (isUnauthorized(e)) {
        removeManageToken(link.id);
        setManageToken(null);
        setActionError(
          "This device no longer has permission to manage the link.",
        );
      } else {
        setActionError(
          e instanceof Error ? e.message : "Could not update the link.",
        );
        setFailedAction({ kind: "archive", nextArchived });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!manageToken) return;
    if (!window.confirm(`Permanently delete ${link.slug}?`)) return;
    setActionError(null);
    setFailedAction(null);
    setBusy(true);
    try {
      await api.paymentLinks.delete.mutate({ id: link.id, manageToken });
      removeManageToken(link.id);
      onDeleted();
    } catch (e) {
      if (isUnauthorized(e)) {
        removeManageToken(link.id);
        setManageToken(null);
        setActionError(
          "This device no longer has permission to manage the link.",
        );
      } else {
        setActionError(
          e instanceof Error ? e.message : "Could not delete the link.",
        );
        setFailedAction({ kind: "delete" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card appearance="linen" className="relative justify-between gap-4">
      <ToastFeedback
        title="Link action not completed"
        message={actionError}
        variant="error"
        toastId={`payment-link-action-error-${link.id}`}
        action={
          failedAction
            ? {
                label: "Try again",
                onClick: () =>
                  failedAction.kind === "archive"
                    ? void archive(failedAction.nextArchived)
                    : void remove(),
              }
            : undefined
        }
      />
      <div className="grid gap-3">
        <div className="min-w-0 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-heading text-lg font-semibold text-foreground">
              {link.slug}
            </h3>
            {archived ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                Archived
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {displayAmount(link)}
            {link.description ? ` · ${link.description}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-6 gap-1">
          <Button
            size="icon"
            variant="secondary"
            className="size-9"
            onClick={copy}
            title={copied ? "Copied" : "Copy"}
            aria-label="Copy link"
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
          <Button
            ref={qrTriggerRef}
            size="icon"
            variant="secondary"
            className="size-9"
            onClick={() => setQrOpen(true)}
            title="Show QR code"
            aria-label="Show QR code"
            aria-expanded={qrOpen}
          >
            <QrCode className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="size-9"
            nativeButton={false}
            render={<a href={url} target="_blank" rel="noreferrer" />}
            title="Open link"
            aria-label="Open link"
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="size-9"
            onClick={() => setEditOpen(true)}
            title={manageTitle ?? "Edit link"}
            aria-label="Edit link"
            disabled={busy || !canManage}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="size-9"
            onClick={() => archive(!archived)}
            title={manageTitle ?? (archived ? "Restore link" : "Archive link")}
            aria-label={archived ? "Restore link" : "Archive link"}
            disabled={busy || !canManage}
          >
            {archived ? (
              <ArchiveRestore className="size-4" />
            ) : (
              <Archive className="size-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="destructive"
            className="size-9"
            onClick={remove}
            title={manageTitle ?? "Delete link"}
            aria-label="Delete link"
            disabled={busy || !canManage}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="truncate rounded-xl bg-secondary px-3 py-2 font-mono text-sm text-foreground ring-1 ring-border">
        {url.replace(/^https?:\/\//, "")}
      </div>

      <PaymentQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        url={url}
        triggerRef={qrTriggerRef}
      />

      <LinkEditorDialog
        mode="edit"
        open={editOpen}
        username={username}
        link={link}
        manageToken={manageToken}
        onOpenChange={setEditOpen}
        onSaved={(next) => {
          setEditOpen(false);
          onChanged(next);
        }}
      />
    </Card>
  );
}
