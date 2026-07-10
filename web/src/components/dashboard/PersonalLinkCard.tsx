"use client";

import { Check, Copy, ExternalLink, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export function PersonalLinkCard({
  username,
  payLink,
}: {
  username: string;
  payLink: string;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const displayLink = payLink.replace(/^https?:\/\//, "");

  async function handleCopy() {
    if (!payLink) return;
    await navigator.clipboard?.writeText(payLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="gap-3 p-6">
      <div>
        <h2 className="font-heading text-base font-semibold text-ink">
          Your Personal Link
        </h2>
        <p className="text-sm text-muted-text">Share to get paid</p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-line bg-sage/40 px-3 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-olive-deep text-sm font-semibold text-paper">
          {username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
          {displayLink || "…"}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleCopy}
            disabled={!payLink}
            aria-label="Copy link"
            title="Copy link"
          >
            {copied ? (
              <Check className="size-4 text-ok" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setQrOpen((v) => !v)}
            disabled={!payLink}
            aria-expanded={qrOpen}
            aria-label="Show QR code"
            title="Show QR code"
          >
            <QrCode className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            nativeButton={false}
            disabled={!payLink}
            aria-label="Open link"
            title="Open link"
            render={<a href={payLink} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {qrOpen && payLink && (
        <div className="flex justify-center rounded-lg border border-line bg-white p-4">
          <QRCodeSVG
            value={payLink}
            size={160}
            fgColor="#20261a"
            bgColor="#ffffff"
          />
        </div>
      )}
    </Card>
  );
}
