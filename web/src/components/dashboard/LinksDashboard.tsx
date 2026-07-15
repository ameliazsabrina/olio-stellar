"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  QrCode,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { usePaymentLinksByOwner } from "../../features/paymentLinks/hooks/usePaymentLink";
import {
  getManageToken,
  removeManageToken,
  storeManageToken,
} from "../../features/paymentLinks/manageTokens";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { fromBaseUnits } from "../../lib/crypto";
import { payUrl } from "../../lib/paymentLinks";
import { createLinkFormInput } from "../../server/modules/paymentLinks/paymentLinks.schema";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ToastFeedback } from "../ui/toast-feedback";
import { DashboardShell } from "./DashboardShell";
import { PaymentQrDialog } from "./PaymentQrDialog";
import { PersonalLinkCard } from "./PersonalLinkCard";

type LinkFormInput = z.input<typeof createLinkFormInput>;
type LinkFormOutput = z.output<typeof createLinkFormInput>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

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
  const { links, loading, refresh, setLinks } =
    usePaymentLinksByOwner(username);
  const [createOpen, setCreateOpen] = useState(false);
  const payLink = username && origin ? `${origin}/pay/${username}` : "";

  async function replaceLink(next: PaymentLink) {
    setLinks((current) =>
      current.map((link) => (link.id === next.id ? next : link)),
    );
  }

  return (
    <DashboardShell navigation showBack>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Links
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-medium text-white/70 sm:text-base">
            Create and manage payment links for invoices, tips, projects, and
            open-ended requests.
          </p>
        </div>
        <Button
          variant="glass"
          className="min-h-11 px-4"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          Create link
        </Button>
      </div>

      <section className="grid gap-4" aria-label="Payment links">
        {(loading || links.length > 0) && (
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-xl font-semibold text-white">
              Payment links
            </h2>
            <span className="text-sm text-white/60">
              {loading ? "Loading..." : `${links.length + 1} total`}
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PersonalLinkCard username={username} payLink={payLink} />
          {loading ? (
            <div
              className="min-h-64 rounded-2xl bg-white/8 ring-1 ring-white/15 backdrop-blur-xl motion-safe:animate-pulse"
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
    </DashboardShell>
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
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!manageToken) return;
    if (!window.confirm(`Permanently delete ${link.slug}?`)) return;
    setBusy(true);
    try {
      await api.paymentLinks.delete.mutate({ id: link.id, manageToken });
      removeManageToken(link.id);
      onDeleted();
    } catch (e) {
      if (isUnauthorized(e)) {
        removeManageToken(link.id);
        setManageToken(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card appearance="glass" className="justify-between gap-4 p-4">
      <div className="grid gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-heading text-lg font-semibold">
              {link.slug}
            </h3>
            {archived ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70">
                Archived
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-white/65">
            {displayAmount(link)}
            {link.description ? ` · ${link.description}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-6 gap-1">
          <Button
            size="icon"
            variant="glass"
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
            variant="glass"
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
            variant="glass"
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
            variant="glass"
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
            variant="glass"
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
            variant="glass"
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

      <div className="truncate rounded-lg bg-white/7 px-3 py-2 font-mono text-sm text-white/85 ring-1 ring-white/12">
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

function LinkEditorDialog({
  mode,
  open,
  username,
  link,
  manageToken,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  username: string;
  link?: PaymentLink;
  manageToken?: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (link: PaymentLink) => void | Promise<void>;
}) {
  const [amountMode, setAmountMode] = useState<"fixed" | "open">(
    link?.amount ? "fixed" : "open",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const initialDescription = link?.description ?? "";
  const initialAmount = link?.amount ? fromBaseUnits(BigInt(link.amount)) : "";
  const defaultSlug = useMemo(
    () => link?.slug ?? `link-${Math.random().toString(36).slice(2, 8)}`,
    [link?.slug],
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LinkFormInput, unknown, LinkFormOutput>({
    resolver: zodResolver(createLinkFormInput),
    defaultValues: {
      username,
      slug: defaultSlug,
      amount: initialAmount,
      description: initialDescription,
    },
  });

  useEffect(() => {
    setAmountMode(link?.amount ? "fixed" : "open");
    reset({
      username,
      slug: defaultSlug,
      amount: initialAmount,
      description: initialDescription,
    });
  }, [
    defaultSlug,
    initialAmount,
    initialDescription,
    link?.amount,
    reset,
    username,
  ]);

  const description = watch("description") ?? "";

  function syncSlug() {
    if (mode === "edit") return;
    const next = slugify(description || defaultSlug);
    if (next) setValue("slug", next, { shouldValidate: true });
  }

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const payload = {
        ...values,
        username,
        amount: amountMode === "fixed" ? values.amount : null,
      };
      let saved: PaymentLink;
      if (mode === "create") {
        const { manageToken: token, ...created } =
          await api.paymentLinks.create.mutate(payload);
        storeManageToken(created.id, token);
        saved = created;
      } else {
        if (!manageToken) throw new Error("This link can't be edited here.");
        saved = await api.paymentLinks.update.mutate({
          id: link?.id ?? "",
          manageToken,
          amount: payload.amount,
          description: payload.description,
        });
      }
      await onSaved(saved);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not save link.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="glass" className="max-w-[520px]">
        <DialogTitle className="text-lg font-semibold">
          {mode === "create" ? "Create Link" : "Edit Link"}
        </DialogTitle>
        <form className="grid gap-4" onSubmit={submit}>
          <input type="hidden" {...register("username")} />
          <div className="grid gap-2">
            <Label className="text-white" htmlFor={`${mode}-link-description`}>
              Description
            </Label>
            <textarea
              id={`${mode}-link-description`}
              className="min-h-28 rounded-lg border border-white/20 bg-white/10 px-3 py-3 text-sm text-white outline-none placeholder:text-white/55 focus-visible:border-white/35 focus-visible:ring-2 focus-visible:ring-white/70"
              placeholder="Tell people what this payment is for..."
              maxLength={500}
              {...register("description")}
              onBlur={syncSlug}
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-white" htmlFor={`${mode}-link-slug`}>
              Link name
            </Label>
            <Input
              appearance="glass"
              id={`${mode}-link-slug`}
              className="min-h-11"
              readOnly={mode === "edit"}
              aria-readonly={mode === "edit"}
              {...register("slug")}
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-white">Amount</Label>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/7 p-1 ring-1 ring-white/12 backdrop-blur-md">
              {(["fixed", "open"] as const).map((modeKey) => (
                <button
                  key={modeKey}
                  type="button"
                  onClick={() => setAmountMode(modeKey)}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    amountMode === modeKey
                      ? "bg-white/18 text-white ring-1 ring-white/25"
                      : "text-white/55 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  {modeKey === "fixed" ? "Fixed Amount" : "Open Amount"}
                </button>
              ))}
            </div>
            {amountMode === "fixed" ? (
              <Input
                appearance="glass"
                className="min-h-11"
                inputMode="decimal"
                placeholder="25.00"
                {...register("amount")}
              />
            ) : null}
          </div>

          <ToastFeedback
            message={errors.slug?.message}
            variant="error"
            toastId="link-slug-error"
          />
          <ToastFeedback
            message={errors.amount?.message}
            variant="error"
            toastId="link-amount-error"
          />
          <ToastFeedback
            message={errors.description?.message}
            variant="error"
            toastId="link-description-error"
          />
          <ToastFeedback
            message={submitError}
            variant="error"
            toastId="link-submit-error"
          />

          <Button
            variant="glass"
            className="min-h-11 mt-4"
            size="lg"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Saving..."
              : mode === "create"
                ? "Create payment link"
                : "Save changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
