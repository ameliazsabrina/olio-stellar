"use client";

import { Loader } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  RecoveryNotConfiguredError,
  RecoveryPinChangeError,
  RecoveryRevisionConflictError,
} from "../../features/recovery/hooks/useChangeRecoveryPin";
import { BadPinError } from "../../lib/pin-errors";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

const PIN_RE = /^\d{6}$/;
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);
type ValidationState = "idle" | "checking" | "valid" | "invalid";

export function ChangeRecoveryPinDialog({
  open,
  onOpenChange,
  onSubmit,
  onValidateCurrentPin,
  isChanging,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (currentPin: string, newPin: string) => Promise<void>;
  onValidateCurrentPin: (currentPin: string) => Promise<boolean>;
  isChanging: boolean;
  onSuccess?: () => void;
}) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentState, setCurrentState] = useState<ValidationState>("idle");
  const [newState, setNewState] = useState<ValidationState>("idle");
  const [confirmationState, setConfirmationState] =
    useState<ValidationState>("idle");
  const submittingRef = useRef(false);
  const currentPinValueRef = useRef("");
  const validCurrentPinRef = useRef<string | null>(null);
  const invalidCurrentPinRef = useRef<string | null>(null);
  const currentCheckRef = useRef<{
    pin: string;
    promise: Promise<boolean>;
  } | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const currentId = useId();
  const newId = useId();
  const confirmationId = useId();

  useEffect(() => {
    if (!open) {
      setCurrentPin("");
      setNewPin("");
      setConfirmation("");
      setCurrentState("idle");
      setNewState("idle");
      setConfirmationState("idle");
      validCurrentPinRef.current = null;
      invalidCurrentPinRef.current = null;
      currentCheckRef.current = null;
      currentPinValueRef.current = "";
      submittingRef.current = false;
    }
  }, [open]);

  function close() {
    if (!isChanging && !submittingRef.current) onOpenChange(false);
  }

  function reportError(message: string) {
    toast.error(message, { id: "change-recovery-pin-error" });
  }

  function validationError(cause: unknown): string {
    if (cause instanceof RecoveryNotConfiguredError) {
      return "Recovery is not configured for this account.";
    }
    if (cause instanceof RecoveryPinChangeError) return cause.message;
    return "We couldn't verify your current PIN. Try again.";
  }

  async function validateCurrent(focusOnError = false): Promise<boolean> {
    if (!PIN_RE.test(currentPin)) {
      setCurrentState("invalid");
      reportError("Current PIN must contain exactly six digits.");
      if (focusOnError) currentRef.current?.focus();
      return false;
    }
    if (validCurrentPinRef.current === currentPin) return true;
    if (invalidCurrentPinRef.current === currentPin) {
      setCurrentState("invalid");
      reportError("Current PIN is incorrect");
      if (focusOnError) currentRef.current?.focus();
      return false;
    }

    let check = currentCheckRef.current;
    if (!check || check.pin !== currentPin) {
      check = { pin: currentPin, promise: onValidateCurrentPin(currentPin) };
      currentCheckRef.current = check;
    }
    setCurrentState("checking");
    try {
      const valid = await check.promise;
      if (currentPinValueRef.current !== check.pin) return false;
      if (valid) {
        validCurrentPinRef.current = check.pin;
        invalidCurrentPinRef.current = null;
        setCurrentState("valid");
        return true;
      }
      invalidCurrentPinRef.current = check.pin;
      validCurrentPinRef.current = null;
      setCurrentState("invalid");
      reportError("Current PIN is incorrect");
      if (focusOnError) currentRef.current?.focus();
      return false;
    } catch (cause) {
      setCurrentState("invalid");
      reportError(validationError(cause));
      if (focusOnError) currentRef.current?.focus();
      return false;
    } finally {
      if (currentCheckRef.current === check) currentCheckRef.current = null;
    }
  }

  function validateNew(focusOnError = false): boolean {
    if (!PIN_RE.test(newPin)) {
      setNewState("invalid");
      reportError("New PIN must contain exactly six digits.");
      if (focusOnError) newRef.current?.focus();
      return false;
    }
    if (newPin === currentPin) {
      setNewState("invalid");
      reportError("Choose a new PIN that differs from your current PIN.");
      if (focusOnError) newRef.current?.focus();
      return false;
    }
    setNewState("valid");
    return true;
  }

  function validateConfirmation(focusOnError = false): boolean {
    if (!PIN_RE.test(confirmation)) {
      setConfirmationState("invalid");
      reportError("Confirm the new six-digit PIN.");
      if (focusOnError) confirmationRef.current?.focus();
      return false;
    }
    if (confirmation !== newPin) {
      setConfirmationState("invalid");
      reportError("The new PINs don't match.");
      if (focusOnError) confirmationRef.current?.focus();
      return false;
    }
    setConfirmationState("valid");
    return true;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isChanging || submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (!validateNew(true) || !validateConfirmation(true)) return;
      if (!(await validateCurrent(true))) return;
      await onSubmit(currentPin, newPin);
      setCurrentPin("");
      setNewPin("");
      setConfirmation("");
      onSuccess?.();
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof BadPinError) {
        invalidCurrentPinRef.current = currentPin;
        validCurrentPinRef.current = null;
        setCurrentState("invalid");
        reportError("Current PIN is incorrect");
        currentRef.current?.focus();
      } else if (cause instanceof RecoveryNotConfiguredError) {
        reportError("Recovery is not configured for this account.");
      } else if (cause instanceof RecoveryRevisionConflictError) {
        reportError(
          "Your PIN was changed in another tab or device. Close this dialog and start again.",
        );
      } else if (cause instanceof RecoveryPinChangeError) {
        reportError(cause.message);
      } else {
        reportError("We couldn't change your recovery PIN. Try again.");
      }
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent appearance="linen" size="md" showCloseButton={!isChanging}>
        <DialogHeader>
          <DialogTitle>Change recovery PIN</DialogTitle>
          <DialogDescription>
            Your funds and payment history stay unchanged. The new PIN will be
            required when you restore Olio on another device.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <PinField
            id={currentId}
            label="Current PIN"
            value={currentPin}
            onChange={(value) => {
              setCurrentPin(value);
              currentPinValueRef.current = value;
              setCurrentState("idle");
              validCurrentPinRef.current = null;
              invalidCurrentPinRef.current = null;
            }}
            onBlur={() => void validateCurrent()}
            inputRef={currentRef}
            autoComplete="current-password"
            autoFocus
            disabled={isChanging}
            validationState={currentState}
          />
          <PinField
            id={newId}
            label="New PIN"
            value={newPin}
            onChange={(value) => {
              setNewPin(value);
              setNewState("idle");
              setConfirmationState("idle");
            }}
            onBlur={() => validateNew()}
            inputRef={newRef}
            autoComplete="new-password"
            disabled={isChanging}
            validationState={newState}
          />
          <PinField
            id={confirmationId}
            label="Confirm new PIN"
            value={confirmation}
            onChange={(value) => {
              setConfirmation(value);
              setConfirmationState("idle");
            }}
            onBlur={() => validateConfirmation()}
            inputRef={confirmationRef}
            autoComplete="new-password"
            disabled={isChanging}
            validationState={confirmationState}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={isChanging}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isChanging} aria-busy={isChanging}>
              {isChanging ? (
                <Loader className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {isChanging ? "Changing…" : "Change PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PinField({
  id,
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  autoComplete,
  disabled,
  validationState,
  autoFocus = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  autoComplete: "current-password" | "new-password";
  disabled: boolean;
  validationState: ValidationState;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        ref={inputRef}
        id={id}
        appearance="linen"
        type="password"
        inputMode="numeric"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        maxLength={6}
        value={value}
        disabled={disabled}
        aria-invalid={validationState === "invalid" || undefined}
        className={cn(
          "min-h-11 text-center tracking-[0.5em]",
          validationState === "valid" &&
            "border-emerald-600 ring-1 ring-emerald-600/25",
          validationState === "invalid" &&
            "border-destructive ring-1 ring-destructive/30",
          validationState === "checking" &&
            "border-amber-600 ring-1 ring-amber-600/25",
        )}
        placeholder="••••••"
        onChange={(event) => onChange(digits(event.target.value))}
        onBlur={onBlur}
      />
    </div>
  );
}
