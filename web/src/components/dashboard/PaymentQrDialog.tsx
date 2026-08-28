"use client";

import { QRCodeSVG } from "qrcode.react";
import type { RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

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
      <DialogContent appearance="linen" size="sm" finalFocus={triggerRef}>
        <DialogHeader>
          <DialogTitle>Payment link QR code</DialogTitle>
          <DialogDescription>
            Scan this code to open the payment link on another device.
          </DialogDescription>
        </DialogHeader>
        <div className="aspect-square w-full rounded-xl bg-brand-linen p-4">
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
