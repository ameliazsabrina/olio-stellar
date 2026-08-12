"use client";

import { QRCodeSVG } from "qrcode.react";
import type { RefObject } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function PaymentQrDialog({
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
  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        finalFocus={triggerRef}
        overlayClassName="bg-brand-obsidian/85"
        className="w-auto max-w-[calc(100%-2rem)] bg-transparent p-0 shadow-none ring-0 backdrop-blur-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">Payment link QR code</DialogTitle>
        <div className="size-[min(18rem,calc(100dvw-2rem),calc(100dvh-2rem))] bg-brand-linen p-4 sm:size-[min(20rem,calc(100dvw-2rem),calc(100dvh-2rem))]">
          <QRCodeSVG
            value={url}
            size={320}
            fgColor="#1A1F12"
            bgColor="#F5F3EA"
            className="size-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
