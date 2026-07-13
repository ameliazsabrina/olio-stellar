"use client";

import { useEffect, useId, useState } from "react";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

const PIN_RE = /^\d{6}$/;

export type PinMode = "set" | "unlock" | "secure";

export function PinDialog({
  open,
  mode,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mode: PinMode;
  submitting: boolean;
  error: string;
  onSubmit: (pin: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");
  const pinId = useId();
  const confirmId = useId();

  // Reset every time the dialog (re)opens or switches mode.
  useEffect(() => {
    if (open) {
      setPin("");
      setConfirm("");
      setLocalError("");
    }
  }, [open, mode]);

  const dualField = mode === "set" || mode === "secure";
  const mandatory = mode === "set"; // only create blocks dismissal
  const title =
    mode === "set"
      ? "Set your recovery PIN"
      : mode === "secure"
        ? "Secure your account"
        : "Unlock your account";
  const description =
    mode === "set"
      ? "This 6-digit PIN encrypts your account key so you can restore your balance on any device. It can't be reset — keep it safe."
      : mode === "secure"
        ? "This account was created before PIN recovery. Set a 6-digit PIN to secure it — it re-keys your account so you can restore it on any device."
        : "Enter your 6-digit PIN to restore your account key on this device and reveal your balance.";
  const cta =
    mode === "set"
      ? "Set PIN"
      : mode === "secure"
        ? "Secure account"
        : "Unlock";

  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!PIN_RE.test(pin)) {
      setLocalError("PIN must be exactly 6 digits.");
      return;
    }
    if (dualField && pin !== confirm) {
      setLocalError("The two PINs don't match.");
      return;
    }
    setLocalError("");
    onSubmit(pin);
  };

  const shownError = localError || error;

  return (
    <Dialog
      open={open}
      // Set mode is mandatory: swallow dismiss requests (Esc / backdrop).
      onOpenChange={(next) => {
        if (!next && !mandatory && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-[420px]" showCloseButton={!mandatory}>
        <div className="grid gap-1.5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>

        {mode === "secure" ? (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="note"
          >
            Any payments received before now stay tied to your old key. Cash
            them out from the original browser first — re-keying makes them
            invisible here.
          </div>
        ) : null}

        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <label htmlFor={pinId} className="text-sm font-medium text-ink">
              {dualField ? "New PIN" : "PIN"}
            </label>
            <Input
              id={pinId}
              // biome-ignore lint/a11y/noAutofocus: single-purpose modal; focus belongs on the only field
              autoFocus
              className="min-h-11 text-center tracking-[0.5em]"
              type="password"
              inputMode="numeric"
              autoComplete={dualField ? "new-password" : "current-password"}
              placeholder="••••••"
              value={pin}
              maxLength={6}
              disabled={submitting}
              onChange={(e) => setPin(onlyDigits(e.target.value))}
            />
          </div>

          {dualField ? (
            <div className="grid gap-1.5">
              <label
                htmlFor={confirmId}
                className="text-sm font-medium text-ink"
              >
                Confirm PIN
              </label>
              <Input
                id={confirmId}
                className="min-h-11 text-center tracking-[0.5em]"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••••"
                value={confirm}
                maxLength={6}
                disabled={submitting}
                onChange={(e) => setConfirm(onlyDigits(e.target.value))}
              />
            </div>
          ) : null}

          {shownError ? (
            <Alert variant="destructive">
              <AlertDescription>{shownError}</AlertDescription>
            </Alert>
          ) : null}

          <Button className="min-h-11" type="submit" disabled={submitting}>
            {submitting ? "Working…" : cta}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
