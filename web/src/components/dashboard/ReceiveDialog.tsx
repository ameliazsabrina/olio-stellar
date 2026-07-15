"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, AtSign, Check, Copy, Link2, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useCreatePaymentLink } from "../../features/paymentLinks/hooks/useCreatePaymentLink";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { payUrl } from "../../lib/paymentLinks";
import { createLinkFormInput } from "../../server/modules/paymentLinks/paymentLinks.schema";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
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
      <DialogContent
        appearance="glass"
        className="w-[calc(100%-2rem)] min-w-0 max-w-[440px] sm:w-full"
      >
        <DialogTitle className="flex items-center gap-2">
          {step === "configure" && (
            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                setStep("method");
              }}
              className="text-muted-text hover:text-ink"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          Receive privately
        </DialogTitle>

        {step === "method" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-text">
              How do you want to get paid?
            </p>
            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                setStep("configure");
              }}
              className="flex items-center gap-3 rounded-lg bg-white/8 px-4 py-3 text-left ring-1 ring-white/15 transition-colors hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Link2 className="size-5 text-olive" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-ink">
                  Create a link or QR
                </div>
                <div className="text-xs text-muted-text">
                  Share a link, with an amount, or open-ended
                </div>
              </div>
            </button>
            <button
              type="button"
              disabled
              className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-3 text-left ring-1 ring-white/10 opacity-60"
            >
              <AtSign className="size-5 text-muted-text" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-ink">
                  Request from a username
                </div>
                <div className="text-xs text-muted-text">Coming soon</div>
              </div>
            </button>
          </div>
        )}

        {step === "configure" && (
          <form className="grid gap-3" onSubmit={create}>
            <input type="hidden" {...register("username")} />
            <label htmlFor="receive-slug" className="text-sm text-ink">
              Link name
            </label>
            <Input
              appearance="glass"
              id="receive-slug"
              className="min-h-11"
              placeholder="july-freelance"
              autoComplete="off"
              {...register("slug")}
            />

            <label htmlFor="receive-amount" className="text-sm text-ink">
              Amount (USDC) <span className="text-muted-text">— optional</span>
            </label>
            <Input
              appearance="glass"
              id="receive-amount"
              className="min-h-11"
              inputMode="decimal"
              placeholder="Any amount"
              autoComplete="off"
              {...register("amount")}
            />

            <label htmlFor="receive-description" className="text-sm text-ink">
              Description <span className="text-muted-text">— optional</span>
            </label>
            <textarea
              id="receive-description"
              className="min-h-24 rounded-lg border border-white/20 bg-white/10 px-3 py-3 text-sm text-white outline-none placeholder:text-white/45 focus-visible:ring-2 focus-visible:ring-white/70"
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
              variant="glass"
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
          <div className="grid place-items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-olive" />
            <div className="text-sm font-medium text-ink">Creating link…</div>
          </div>
        )}

        {step === "done" && link && (
          <div className="grid min-w-0 max-w-full gap-3 overflow-hidden">
            <div className="text-sm text-muted-text">
              {link.amount
                ? "Share this link to get paid the exact amount."
                : "Share this link — the payer chooses the amount."}
              {link.description ? ` · ${link.description}` : ""}
            </div>

            <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg border border-line bg-sage/40 px-3 py-2.5">
              <div className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
                {url.replace(/^https?:\/\//, "")}
              </div>
              <Button
                size="icon-sm"
                variant="glass"
                onClick={handleCopy}
                aria-label="Copy link"
                title="Copy link"
              >
                {copied ? (
                  <Check className="size-4 text-ok" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>

            <div className="flex max-w-full justify-center overflow-hidden rounded-lg border border-line bg-white p-4">
              <QRCodeSVG
                value={url}
                size={168}
                fgColor="#20261a"
                bgColor="#ffffff"
                className="h-auto max-w-full"
              />
            </div>

            <Button
              variant="glass"
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
