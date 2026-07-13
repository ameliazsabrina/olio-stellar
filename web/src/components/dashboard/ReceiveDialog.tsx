"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  AtSign,
  Check,
  Copy,
  Link2,
  Loader2,
  QrCode,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useCreatePaymentLink } from "../../features/paymentLinks/hooks/useCreatePaymentLink";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { payUrl } from "../../lib/paymentLinks";
import { createLinkFormInput } from "../../server/modules/paymentLinks/paymentLinks.schema";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

type Step = "method" | "configure" | "creating" | "done";
type CreateLinkFormInput = z.input<typeof createLinkFormInput>;
type CreateLinkFormOutput = z.output<typeof createLinkFormInput>;

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
    formState: { errors, isSubmitting },
  } = useForm<CreateLinkFormInput, unknown, CreateLinkFormOutput>({
    resolver: zodResolver(createLinkFormInput),
    defaultValues: { username, amount: "", label: "" },
  });

  const url = link ? payUrl(origin, link.owner, link.id) : "";

  function reset() {
    setStep("method");
    setSubmitError(null);
    setLink(null);
    setCopied(false);
    resetForm({ username, amount: "", label: "" });
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

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-[440px]">
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
              className="flex items-center gap-3 rounded-lg border border-line bg-white/60 px-4 py-3 text-left transition-colors hover:border-olive/40 hover:bg-sage/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive/50"
            >
              <Link2 className="size-5 text-olive" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-ink">
                  Create a link or QR
                </div>
                <div className="text-xs text-muted-text">
                  Share a link — with an amount, or open-ended
                </div>
              </div>
            </button>
            <button
              type="button"
              disabled
              className="flex items-center gap-3 rounded-lg border border-line bg-white/40 px-4 py-3 text-left opacity-60"
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
            <label htmlFor="receive-amount" className="text-sm text-ink">
              Amount (USDC) <span className="text-muted-text">— optional</span>
            </label>
            <Input
              id="receive-amount"
              className="min-h-11"
              inputMode="decimal"
              placeholder="Any amount"
              autoComplete="off"
              {...register("amount")}
            />

            <label htmlFor="receive-label" className="text-sm text-ink">
              Label <span className="text-muted-text">— optional</span>
            </label>
            <Input
              id="receive-label"
              className="min-h-11"
              placeholder="What's it for? (e.g. Invoice #12)"
              autoComplete="off"
              maxLength={120}
              {...register("label")}
            />

            {errors.amount && (
              <Alert variant="destructive">
                <AlertDescription>{errors.amount.message}</AlertDescription>
              </Alert>
            )}
            {errors.label && (
              <Alert variant="destructive">
                <AlertDescription>{errors.label.message}</AlertDescription>
              </Alert>
            )}
            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            <Button
              className="min-h-11"
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
          <div className="grid gap-3">
            <div className="text-sm text-muted-text">
              {link.amount
                ? "Share this link to get paid the exact amount."
                : "Share this link — the payer chooses the amount."}
              {link.label ? ` · ${link.label}` : ""}
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-line bg-sage/40 px-3 py-2.5">
              <div className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
                {url.replace(/^https?:\/\//, "")}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
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

            <div className="flex justify-center rounded-lg border border-line bg-white p-4">
              <QRCodeSVG
                value={url}
                size={168}
                fgColor="#20261a"
                bgColor="#ffffff"
              />
            </div>

            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-text">
              <QrCode className="size-3.5" aria-hidden="true" />
              Scan or share — payment arrives as a private note.
            </div>

            <Button
              className="mt-1 min-h-11"
              size="lg"
              variant="secondary"
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
