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
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-ink">
            Personal pay link
          </h2>
          <p className="mt-1 text-sm text-muted-text">
            Default route for open payments.
          </p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sage text-olive-deep">
          <QrCode className="size-4" aria-hidden="true" />
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-line bg-sage/30 p-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-olive-deep text-sm font-semibold text-paper">
            {username.slice(0, 1).toUpperCase() || "O"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-text">Payee</div>
            <div className="truncate text-sm font-medium text-ink">
              {username ? `@${username}` : "Username pending"}
            </div>
          </div>
        </div>

        <div className="min-w-0 truncate rounded-md bg-panel/80 px-3 py-2 font-mono text-sm text-ink">
          {displayLink || "..."}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleCopy}
            disabled={!payLink}
          >
            {copied ? (
              <Check className="size-3.5 text-ok" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setQrOpen((v) => !v)}
            disabled={!payLink}
            aria-expanded={qrOpen}
          >
            <QrCode className="size-3.5" aria-hidden="true" />
            QR
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            disabled={!payLink}
            render={<a href={payLink} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Open
          </Button>
        </div>
      </div>

      {qrOpen && payLink && (
        <div className="flex justify-center rounded-lg border border-line bg-white p-4">
          <QRCodeSVG
            value={payLink}
            size={156}
            fgColor="#20261a"
            bgColor="#ffffff"
          />
        </div>
      )}

      <div className="rounded-lg border border-gold/20 bg-paper/70 px-3 py-2 text-xs leading-5 text-muted-text">
        Payment-specific links can lock an amount. This personal link stays open
        for any payer.
      </div>
    </Card>
  );
}
