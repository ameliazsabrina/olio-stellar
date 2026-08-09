"use client";

import { Loader } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ToastFeedback } from "./ui/toast-feedback";

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
  const resetKey = open ? mode : null;

  useEffect(() => {
    if (!resetKey) return;
    setPin("");
    setConfirm("");
    setLocalError("");
  }, [resetKey]);

  const dualField = mode === "set" || mode === "secure";
  const mandatory = mode === "set"; // only create blocks dismissal
  const title =
    mode === "set"
      ? "Set Your Recovery PIN"
      : mode === "secure"
        ? "Secure your account"
        : "Unlock your account";
  const description =
    mode === "set"
      ? "This 6-digit PIN encrypts your account key so you can restore your balance on any device. It can't be reset, so keep it safe."
      : mode === "secure"
        ? "This account predates PIN recovery. First, cash out old payments from your original browser. Then set a 6-digit PIN to re-key your account and restore it on any device."
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
      <DialogContent
        appearance="glass"
        className="max-w-[420px] gap-0"
        showCloseButton={!mandatory}
      >
        <DialogTitle className="text-lg font-semibold text-center">
          {title}
        </DialogTitle>
        <DialogDescription className="mx-auto mt-2 max-w-[36ch] text-center text-sm leading-4">
          {description}
        </DialogDescription>

        <form className="mt-6 grid gap-3" onSubmit={submit}>
          <div className="grid gap-2">
            <label htmlFor={pinId} className="text-sm font-medium text-white">
              {dualField ? "New PIN" : "PIN"}
            </label>
            <Input
              appearance="glass"
              id={pinId}
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
            <div className="grid gap-2">
              <label
                htmlFor={confirmId}
                className="text-sm font-medium text-white"
              >
                Confirm PIN
              </label>
              <Input
                appearance="glass"
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

          <ToastFeedback
            message={shownError}
            variant="error"
            toastId="pin-error"
          />

          <Button
            variant="glass"
            className="min-h-11 w-full mt-4"
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {submitting ? "Working…" : cta}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
