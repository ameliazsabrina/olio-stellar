"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, AtSign, Check, Copy, Link2, Loader } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useCreatePaymentLink } from "../../features/paymentLinks/hooks/useCreatePaymentLink";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { payUrl } from "../../lib/paymentLinks";
import { cn } from "../../lib/utils";
import { createLinkFormInput } from "../../server/modules/paymentLinks/paymentLinks.schema";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenFieldClass, linenInsetClass } from "../ui/glass";
import { Input } from "../ui/input";
import { ToastFeedback } from "../ui/toast-feedback";

type Step = "method" | "configure" | "creating" | "done";
type CreateLinkFormInput = z.input<typeof createLinkFormInput>;
type CreateLinkFormOutput = z.output<typeof createLinkFormInput>;

function defaultSlug() {
  return `link-${Math.random().toString(36).slice(2, 8)}`;
}

export function ReceiveDialog({
  open,
  onClose,
  username,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  origin: string;
}) {
  const [step, setStep] = useState<Step>("method");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [copied, setCopied] = useState(false);
  const { createPaymentLink, isCreating } = useCreatePaymentLink();
  const {
    register,
    handleSubmit,
    reset: resetForm,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateLinkFormInput, unknown, CreateLinkFormOutput>({
    resolver: zodResolver(createLinkFormInput),
    defaultValues: {
      username,
      slug: defaultSlug(),
      amount: "",
      description: "",
    },
  });

  const description = watch("description") ?? "";
  const url = link ? payUrl(origin, link.owner, link.slug) : "";

  function reset() {
    setStep("method");
    setSubmitError(null);
    setLink(null);
    setCopied(false);
    resetForm({
      username,
      slug: defaultSlug(),
      amount: "",
      description: "",
    });
  }

  function handleClose() {
    reset();
    onClose();
  }

  const create = handleSubmit(async (values) => {
    if (!username) {
      setSubmitError("Claim a username first to create a payment link.");
      return;
    }
    setSubmitError(null);
    setStep("creating");
    try {
      const created = await createPaymentLink({ ...values, username });
      setLink(created);
      setStep("done");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not create link.");
      setStep("configure");
    }
  });

  function syncSlug() {
    const slug = description
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 64);
    if (slug) setValue("slug", slug, { shouldValidate: true });
  }

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step === "configure" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSubmitError(null);
                  setStep("method");
                }}
                className="-ml-2 shrink-0 rounded-full text-foreground/65 hover:bg-foreground/10 hover:text-foreground"
                aria-label="Back"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            )}
            <DialogTitle>Receive privately</DialogTitle>
          </div>
          <DialogDescription>
            {step === "method" && "Choose how you want to receive funds."}
            {step === "configure" &&
              "Create a shareable payment link with an optional fixed amount."}
            {step === "creating" &&
              "Your private payment link is being prepared."}
            {step === "done" && "Your payment link is ready to share."}
          </DialogDescription>
        </DialogHeader>

        {step === "method" && (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                setStep("configure");
              }}
              className={cn(
                linenInsetClass,
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-foreground/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70",
              )}
            >
              <Link2 className="size-5 text-foreground/70" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Create a link or QR
                </div>
                <div className="text-xs text-foreground/60">
                  Share a link, with an amount, or open-ended
                </div>
              </div>
            </button>
            <button
              type="button"
              disabled
              className={cn(
                linenInsetClass,
                "flex cursor-not-allowed items-center gap-3 rounded-2xl px-4 py-3 text-left text-foreground/45",
              )}
            >
              <AtSign className="size-5" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium">
                  Request from a username
                </div>
                <div className="text-xs">Coming soon</div>
              </div>
            </button>
          </div>
        )}

        {step === "configure" && (
          <form className="grid gap-3" onSubmit={create}>
            <input type="hidden" {...register("username")} />
            <label
              htmlFor="receive-slug"
              className="text-sm text-foreground/70"
            >
              Link name
            </label>
            <Input
              appearance="linen"
              id="receive-slug"
              className="min-h-11"
              placeholder="july-freelance"
              autoComplete="off"
              {...register("slug")}
            />

            <label
              htmlFor="receive-amount"
              className="text-sm text-foreground/70"
            >
              Amount (USDC){" "}
              <span className="text-foreground/60">— optional</span>
            </label>
            <Input
              appearance="linen"
              id="receive-amount"
              className="min-h-11"
              inputMode="decimal"
              placeholder="Any amount"
              autoComplete="off"
              {...register("amount")}
            />

            <label
              htmlFor="receive-description"
              className="text-sm text-foreground/70"
            >
              Description <span className="text-foreground/60">— optional</span>
            </label>
            <textarea
              id="receive-description"
              className={cn(
                linenFieldClass,
                "min-h-24 rounded-xl border px-3 py-3 text-sm outline-none focus-visible:ring-2",
              )}
              placeholder="What's it for? (e.g. Invoice #12)"
              autoComplete="off"
              maxLength={500}
              {...register("description")}
              onBlur={syncSlug}
            />

            <ToastFeedback
              message={errors.slug?.message}
              variant="error"
              toastId="receive-slug-error"
            />
            <ToastFeedback
              message={errors.amount?.message}
              variant="error"
              toastId="receive-amount-error"
            />
            <ToastFeedback
              message={errors.description?.message}
              variant="error"
              toastId="receive-description-error"
            />
            <ToastFeedback
              message={submitError}
              variant="error"
              toastId="receive-submit-error"
            />

            <Button
              variant="default"
              className="min-h-11 mt-4"
              size="lg"
              type="submit"
              disabled={isSubmitting || isCreating}
            >
              Create link
            </Button>
          </form>
        )}

        {step === "creating" && (
          <div className="flex items-center justify-center gap-3 py-8 text-center">
            <Loader
              className="size-8 text-foreground/70 motion-safe:animate-spin"
              aria-hidden="true"
            />
            <div className="text-sm font-medium text-foreground">
              Creating link…
            </div>
          </div>
        )}

        {step === "done" && link && (
          <div className="grid min-w-0 max-w-full gap-3 overflow-hidden">
            <div className="text-sm text-foreground/65">
              {link.amount
                ? "Share this link to get paid the exact amount."
                : "Share this link — the payer chooses the amount."}
              {link.description ? ` · ${link.description}` : ""}
            </div>

            <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl border border-foreground/15 bg-foreground/8 px-3 py-2.5">
              <div className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                {url.replace(/^https?:\/\//, "")}
              </div>
              <Button
                size="icon-sm"
                variant="default"
                onClick={handleCopy}
                aria-label="Copy link"
                title="Copy link"
              >
                {copied ? (
                  <Check
                    className="size-4 text-primary-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>

            <div className="flex max-w-full justify-center overflow-hidden rounded-xl border border-foreground/20 bg-brand-linen p-4">
              <QRCodeSVG
                value={url}
                size={168}
                fgColor="#1A1F12"
                bgColor="#F5F3EA"
                className="h-auto max-w-full"
              />
            </div>

            <Button
              variant="default"
              className="mt-4 min-h-11 w-full"
              size="lg"
              onClick={handleClose}
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
