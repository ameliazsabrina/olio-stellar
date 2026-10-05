"use client";

import { Loader } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ToastFeedback } from "./ui/toast-feedback";

const PIN_RE = /^\d{6}$/;
type ValidationState = "idle" | "valid" | "invalid";

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
  const [pinState, setPinState] = useState<ValidationState>("idle");
  const [confirmState, setConfirmState] = useState<ValidationState>("idle");
  const pinRef = useRef<HTMLInputElement>(null);
  const pinId = useId();
  const confirmId = useId();
  const resetKey = open ? mode : null;

  useEffect(() => {
    if (!resetKey) return;
    setPin("");
    setConfirm("");
    setLocalError("");
    setPinState("idle");
    setConfirmState("idle");
  }, [resetKey]);

  useEffect(() => {
    if (!error) return;
    setPinState("invalid");
    if (mode === "unlock" && /incorrect pin/i.test(error)) {
      setPin("");
      pinRef.current?.focus();
    }
  }, [error, mode]);

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

  const validatePin = () => {
    const valid = PIN_RE.test(pin);
    // In unlock mode this only validates the six-digit shape. The PIN is not
    // authenticated until the encrypted escrow is opened after submission, so
    // a green "valid" treatment here would incorrectly imply it was accepted.
    setPinState(
      valid && mode !== "unlock" ? "valid" : valid ? "idle" : "invalid",
    );
    if (!valid) setLocalError("PIN must be exactly 6 digits.");
    return valid;
  };

  const validateConfirm = () => {
    const valid = PIN_RE.test(confirm) && pin === confirm;
    setConfirmState(valid ? "valid" : "invalid");
    if (!valid) {
      setLocalError(
        PIN_RE.test(confirm)
          ? "The two PINs don't match."
          : "Confirmation PIN must be exactly 6 digits.",
      );
    }
    return valid;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePin()) return;
    if (dualField && !validateConfirm()) return;
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
      <DialogContent appearance="linen" size="sm" showCloseButton={!mandatory}>
        <DialogHeader className="px-10 text-center">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mx-auto">
            {description}
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-2">
            <label
              htmlFor={pinId}
              className="text-sm font-medium text-foreground"
            >
              {dualField ? "New PIN" : "PIN"}
            </label>
            <Input
              ref={pinRef}
              appearance="linen"
              id={pinId}
              autoFocus
              className={validationClass(pinState)}
              type="password"
              inputMode="numeric"
              autoComplete={dualField ? "new-password" : "current-password"}
              placeholder="••••••"
              value={pin}
              maxLength={6}
              disabled={submitting}
              aria-invalid={pinState === "invalid" || undefined}
              onChange={(e) => {
                setPin(onlyDigits(e.target.value));
                setPinState("idle");
                setConfirmState("idle");
                setLocalError("");
              }}
              onBlur={validatePin}
            />
          </div>

          {dualField ? (
            <div className="grid gap-2">
              <label
                htmlFor={confirmId}
                className="text-sm font-medium text-foreground"
              >
                Confirm PIN
              </label>
              <Input
                appearance="linen"
                id={confirmId}
                className={validationClass(confirmState)}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••••"
                value={confirm}
                maxLength={6}
                disabled={submitting}
                aria-invalid={confirmState === "invalid" || undefined}
                onChange={(e) => {
                  setConfirm(onlyDigits(e.target.value));
                  setConfirmState("idle");
                  setLocalError("");
                }}
                onBlur={validateConfirm}
              />
            </div>
          ) : null}

          <ToastFeedback
            message={shownError}
            variant="error"
            toastId="pin-error"
          />

          <Button
            variant="default"
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

function validationClass(state: ValidationState): string {
  return cn(
    "min-h-11 text-center tracking-[0.5em]",
    state === "valid" && "border-emerald-600 ring-1 ring-emerald-600/25",
    state === "invalid" && "border-destructive ring-1 ring-destructive/30",
  );
}
