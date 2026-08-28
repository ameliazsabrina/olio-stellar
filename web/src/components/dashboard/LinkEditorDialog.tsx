"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { storeManageToken } from "../../features/paymentLinks/manageTokens";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { fromBaseUnits } from "../../lib/crypto";
import { createLinkFormInput } from "../../server/modules/paymentLinks/paymentLinks.schema";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenFieldClass, linenSegmentedClass } from "../ui/glass";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ToastFeedback } from "../ui/toast-feedback";

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

export function LinkEditorDialog({
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
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not save link.",
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create link" : "Edit link"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Set what the payment is for and whether the amount is fixed."
              : "Update the payment details people see when they open this link."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <input type="hidden" {...register("username")} />
          <div className="grid gap-2">
            <Label
              className="text-foreground"
              htmlFor={`${mode}-link-description`}
            >
              Description
            </Label>
            <textarea
              id={`${mode}-link-description`}
              className={`${linenFieldClass} min-h-28 rounded-lg border px-3 py-3 text-sm outline-none focus-visible:ring-2`}
              placeholder="Tell people what this payment is for..."
              maxLength={500}
              {...register("description")}
              onBlur={syncSlug}
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-foreground" htmlFor={`${mode}-link-slug`}>
              Link name
            </Label>
            <Input
              appearance="linen"
              id={`${mode}-link-slug`}
              className="min-h-11"
              readOnly={mode === "edit"}
              aria-readonly={mode === "edit"}
              {...register("slug")}
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-foreground">Amount</Label>
            <div
              className={`${linenSegmentedClass} grid grid-cols-2 gap-1 p-1`}
            >
              {(["fixed", "open"] as const).map((modeKey) => (
                <button
                  key={modeKey}
                  type="button"
                  onClick={() => setAmountMode(modeKey)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    amountMode === modeKey
                      ? "bg-foreground/18 text-foreground ring-1 ring-foreground/25"
                      : "text-foreground/65 hover:bg-foreground/8 hover:text-foreground"
                  }`}
                >
                  {modeKey === "fixed" ? "Fixed Amount" : "Open Amount"}
                </button>
              ))}
            </div>
            {amountMode === "fixed" ? (
              <Input
                appearance="linen"
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
            variant="default"
            className="mt-4 min-h-11"
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
