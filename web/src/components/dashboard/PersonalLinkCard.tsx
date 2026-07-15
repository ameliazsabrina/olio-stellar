"use client";

import { Check, Copy, ExternalLink, QrCode, ReceiptText } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { PaymentQrDialog } from "./PaymentQrDialog";

export function PersonalLinkCard({
  payLink,
}: {
  username: string;
  payLink: string;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const displayLink = payLink.replace(/^https?:\/\//, "");

  async function handleCopy() {
    if (!payLink) return;
    await navigator.clipboard?.writeText(payLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card
      appearance="glass"
      className="relative justify-between gap-4 p-5 sm:p-6"
    >
      <div>
        <h2 className="font-heading text-lg font-semibold text-white">
          Personal pay link
        </h2>
        <p className="text-sm text-white/55">Share to get paid</p>
      </div>

      <div className="grid min-h-0 gap-3">
        <div className="flex items-center gap-3 rounded-lg bg-white/7 p-3 ring-1 ring-white/12 backdrop-blur-md">
          <div className="flex size-10 shrink-0 rotate-2 items-center justify-center rounded-lg border border-white/15 bg-white/8 text-white">
            <ReceiptText className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-white">
            {displayLink || "Link unavailable"}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1">
          <Button
            size="icon"
            variant="glass"
            className="w-full"
            onClick={handleCopy}
            disabled={!payLink}
            aria-label={copied ? "Link copied" : "Copy payment link"}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            ref={qrTriggerRef}
            size="icon"
            variant="glass"
            className="w-full"
            onClick={() => setQrOpen(true)}
            disabled={!payLink}
            aria-label="Show payment QR code"
            aria-expanded={qrOpen}
            title="Show QR code"
          >
            <QrCode className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="glass"
            className="w-full"
            nativeButton={false}
            disabled={!payLink}
            render={<a href={payLink} target="_blank" rel="noreferrer" />}
            aria-label="Open payment link"
            title="Open link"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {payLink ? (
        <PaymentQrDialog
          open={qrOpen}
          onOpenChange={setQrOpen}
          url={payLink}
          triggerRef={qrTriggerRef}
        />
      ) : null}
    </Card>
  );
}
