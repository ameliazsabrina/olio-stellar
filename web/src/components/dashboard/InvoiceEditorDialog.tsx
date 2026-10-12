"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  contentToForm,
  dueDateToIso,
  emptyInvoiceForm,
  emptyLineItem,
  formToContent,
  formTotal,
  type InvoiceFormValues,
  invoiceFormSchema,
  type OpenedInvoice,
  sealInvoice,
} from "../../features/invoices/invoiceContent";
import { fromBaseUnits } from "../../lib/crypto";
import { newInvoiceKey } from "../../lib/invoiceCrypto";
import { resolveUsername } from "../../lib/stellar";
import type { RouterOutputs } from "../../server/root";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  linenFieldClass,
  linenInsetClass,
  linenSegmentedClass,
} from "../ui/glass";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ToastFeedback } from "../ui/toast-feedback";

type InvoiceSummary = RouterOutputs["invoices"]["list"]["items"][number];

export function InvoiceEditorDialog({
  mode,
  open,
  businessId,
  username,
  invoice,
  opened,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "revise";
  open: boolean;
  businessId: string;
  username: string;
  invoice?: InvoiceSummary;
  opened?: OpenedInvoice | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (invoice: InvoiceSummary) => void | Promise<void>;
}) {
  const [issueNow, setIssueNow] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: emptyInvoiceForm(),
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "lineItems",
  });

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setIssueNow(true);
    reset(
      mode === "revise" && opened && invoice
        ? contentToForm(opened.content, invoice.current.dueAt)
        : emptyInvoiceForm(),
    );
  }, [open, mode, opened, invoice, reset]);

  const total = formTotal(watch());
  const lineErrors = errors.lineItems;
  const firstLineError = Array.isArray(lineErrors)
    ? lineErrors
        .map(
          (item) =>
            item?.description?.message ??
            item?.quantity?.message ??
            item?.unitPrice?.message,
        )
        .find(Boolean)
    : lineErrors?.message;

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const registered = await resolveUsername(username);
      if (!registered)
        throw new Error("Register your username before issuing invoices.");
      if (mode === "revise" && !opened)
        throw new Error("Unlock your account to revise this invoice.");
      const key = mode === "revise" && opened ? opened.key : newInvoiceKey();
      const sealed = sealInvoice(
        formToContent(values),
        key,
        registered.view_pubkey,
      );
      const dueAt = dueDateToIso(values.dueDate);
      const saved =
        mode === "create"
          ? await api.invoices.create.mutate({
              businessId,
              ...sealed,
              dueAt,
              issue: issueNow,
            })
          : await api.invoices.revise.mutate({
              invoiceId: invoice?.invoiceId ?? "",
              expectedVersion: invoice?.currentVersion ?? 0,
              ...sealed,
              dueAt,
            });
      await onSaved(saved);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not save the invoice.",
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New invoice" : "Revise invoice"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Details are encrypted in this browser. Olio only stores the amount, due date and a commitment."
              : "Revising issues a new version. Earlier versions stay on record."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label className="text-foreground" htmlFor="invoice-customer-name">
              Customer
            </Label>
            <Input
              appearance="linen"
              id="invoice-customer-name"
              className="min-h-11"
              placeholder="Customer or company name"
              autoComplete="off"
              {...register("customerName")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label
                className="text-foreground"
                htmlFor="invoice-customer-email"
              >
                Email
              </Label>
              <Input
                appearance="linen"
                id="invoice-customer-email"
                className="min-h-11"
                type="email"
                placeholder="Optional"
                autoComplete="off"
                {...register("customerEmail")}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-foreground" htmlFor="invoice-due-date">
                Due date
              </Label>
              <Input
                appearance="linen"
                id="invoice-due-date"
                className="min-h-11"
                type="date"
                {...register("dueDate")}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label
              className="text-foreground"
              htmlFor="invoice-customer-address"
            >
              Billing address
            </Label>
            <textarea
              id="invoice-customer-address"
              className={`${linenFieldClass} min-h-20 rounded-lg border px-3 py-3 text-sm outline-none focus-visible:ring-2`}
              placeholder="Optional"
              maxLength={500}
              {...register("customerAddress")}
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Line items
            </legend>
            {fields.map((field, index) => (
              <div
                key={field.id}
                className={`${linenInsetClass} grid gap-2 p-3`}
              >
                <Input
                  appearance="linen"
                  className="min-h-11"
                  placeholder="Description"
                  aria-label={`Line ${index + 1} description`}
                  {...register(`lineItems.${index}.description`)}
                />
                <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] gap-2">
                  <Input
                    appearance="linen"
                    className="min-h-11"
                    inputMode="numeric"
                    aria-label={`Line ${index + 1} quantity`}
                    {...register(`lineItems.${index}.quantity`)}
                  />
                  <Input
                    appearance="linen"
                    className="min-h-11"
                    inputMode="decimal"
                    placeholder="Unit price (USDC)"
                    aria-label={`Line ${index + 1} unit price in USDC`}
                    {...register(`lineItems.${index}.unitPrice`)}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-11"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                    title="Remove line"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-10 w-fit"
              onClick={() => append({ ...emptyLineItem })}
              disabled={fields.length >= 50}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add line
            </Button>
          </fieldset>

          <div className="grid gap-2">
            <Label className="text-foreground" htmlFor="invoice-notes">
              Notes
            </Label>
            <textarea
              id="invoice-notes"
              className={`${linenFieldClass} min-h-20 rounded-lg border px-3 py-3 text-sm outline-none focus-visible:ring-2`}
              placeholder="Payment terms, reference numbers…"
              maxLength={1000}
              {...register("notes")}
            />
          </div>

          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
            <span className="text-sm font-medium text-foreground">Total</span>
            <span
              className="font-mono text-base font-semibold text-foreground"
              aria-live="polite"
            >
              {total !== null ? `${fromBaseUnits(total)} USDC` : "—"}
            </span>
          </div>

          {mode === "create" ? (
            <div
              className={`${linenSegmentedClass} grid grid-cols-2 gap-1 p-1`}
            >
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={issueNow === value}
                  onClick={() => setIssueNow(value)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    issueNow === value
                      ? "bg-foreground/18 text-foreground ring-1 ring-foreground/25"
                      : "text-foreground/65 hover:bg-foreground/8 hover:text-foreground"
                  }`}
                >
                  {value ? "Issue now" : "Save draft"}
                </button>
              ))}
            </div>
          ) : null}

          <ToastFeedback
            message={errors.customerName?.message}
            variant="error"
            toastId="invoice-customer-error"
          />
          <ToastFeedback
            message={errors.customerEmail?.message}
            variant="error"
            toastId="invoice-email-error"
          />
          <ToastFeedback
            message={firstLineError}
            variant="error"
            toastId="invoice-line-error"
          />
          <ToastFeedback
            message={submitError}
            variant="error"
            toastId="invoice-submit-error"
          />

          <Button
            variant="default"
            className="mt-2 min-h-11"
            size="lg"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {isSubmitting
              ? "Encrypting…"
              : mode === "revise"
                ? invoice?.state === "draft"
                  ? "Save draft"
                  : "Issue revision"
                : issueNow
                  ? "Issue invoice"
                  : "Save draft"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
