"use client";

import { Check, Copy, MessageCircle, Send } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { RefObject } from "react";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

const SHARE_DESTINATIONS = [
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "linkedin", label: "LinkedIn" },
] as const;

type ShareDestination = (typeof SHARE_DESTINATIONS)[number]["id"];

function shareHref(destination: ShareDestination, url: string) {
  const encodedUrl = encodeURIComponent(url);
  const message = encodeURIComponent("Here is my private payment link");

  switch (destination) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "x":
      return `https://x.com/intent/post?url=${encodedUrl}&text=${message}`;
    case "whatsapp":
      return `https://wa.me/?text=${message}%20${encodedUrl}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodedUrl}&text=${message}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
  }
}

export function ShareLinkSketchIcon({
  className = "size-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M13.1 20.7l-2.25 2.25a5.1 5.1 0 01-7.2-7.2l4.1-4.1a5.1 5.1 0 017.2 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.9 11.3l2.25-2.25a5.1 5.1 0 017.2 7.2l-4.1 4.1a5.1 5.1 0 01-7.2 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.8 21.15L21.2 10.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9.7 19.8L20 9.55"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

export function ShareLinkDialog({
  open,
  onOpenChange,
  url,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        appearance="glass"
        finalFocus={triggerRef}
        className="gap-5 p-5 sm:max-w-lg sm:p-7"
      >
        <div className="grid justify-items-center gap-3 text-center">
          <div className="flex size-16 -rotate-3 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-sm">
            <ShareLinkSketchIcon className="size-9" />
          </div>
          <div className="grid gap-1.5">
            <DialogTitle className="text-2xl font-semibold">
              Share payment link
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Send this link or let someone scan the QR code.
            </DialogDescription>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-sm font-semibold text-white/80">Share link</div>
          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-white/7 p-2 ring-1 ring-white/12">
            <div className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-white/85">
              {url.replace(/^https?:\/\//, "")}
            </div>
            <Button
              size="icon-sm"
              variant="glass"
              onClick={copyLink}
              aria-label={copied ? "Payment link copied" : "Copy payment link"}
              title={copied ? "Copied" : "Copy link"}
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-sm font-semibold text-white/80">Scan to pay</div>
          <div className="mx-auto rounded-xl bg-white p-3 shadow-sm">
            <QRCodeSVG
              value={url}
              size={176}
              fgColor="#20261a"
              bgColor="#ffffff"
              className="size-40 sm:size-44"
            />
          </div>
        </div>

        <div className="grid gap-3">
          <div className="text-sm font-semibold text-white/80">Share to</div>
          <div className="grid grid-cols-5 gap-2">
            {SHARE_DESTINATIONS.map((destination) => (
              <a
                key={destination.id}
                href={shareHref(destination.id, url)}
                target="_blank"
                rel="noreferrer"
                className="group grid min-w-0 justify-items-center gap-1.5 rounded-lg py-1 text-center text-[0.65rem] font-medium text-white/55 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
                aria-label={`Share on ${destination.label}`}
              >
                <span className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-sm font-semibold text-white/80 transition-colors group-hover:bg-white/14 group-hover:text-white">
                  <SocialMark destination={destination.id} />
                </span>
                <span className="max-w-full truncate">{destination.label}</span>
              </a>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SocialMark({ destination }: { destination: ShareDestination }) {
  if (destination === "facebook") {
    return <span className="text-xl font-bold">f</span>;
  }
  if (destination === "x") {
    return <span className="text-base">𝕏</span>;
  }
  if (destination === "whatsapp") {
    return <MessageCircle className="size-5" aria-hidden="true" />;
  }
  if (destination === "telegram") {
    return <Send className="size-5 -rotate-12" aria-hidden="true" />;
  }
  return <span className="text-sm font-bold">in</span>;
}
