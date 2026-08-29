"use client";

import { useState } from "react";
import { rotateEscrow, verifyEscrowPin } from "../../../lib/keys";
import { BadPinError } from "../../../lib/pin-errors";
import { api } from "../../../trpc/client";
import { trpc } from "../../../trpc/react";

export class RecoveryNotConfiguredError extends Error {
  constructor() {
    super("Recovery is not configured.");
    this.name = "RecoveryNotConfiguredError";
  }
}

export class RecoveryRevisionConflictError extends Error {
  constructor() {
    super(
      "Your PIN was changed in another tab or device. Start again with the current PIN.",
    );
    this.name = "RecoveryRevisionConflictError";
  }
}

export class RecoveryPinChangeError extends Error {
  constructor() {
    super(
      "We couldn't change your recovery PIN. Check your connection and try again.",
    );
    this.name = "RecoveryPinChangeError";
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { data?: { code?: string } })?.data?.code;
}

function sameEscrow(
  left: {
    encryptedMasterHex: string;
    masterSaltHex: string;
    kdfParams: { m: number; t: number; p: number };
  },
  right: {
    encryptedMasterHex: string;
    masterSaltHex: string;
    kdfParams: { m: number; t: number; p: number };
  },
): boolean {
  return (
    left.encryptedMasterHex === right.encryptedMasterHex &&
    left.masterSaltHex === right.masterSaltHex &&
    left.kdfParams.m === right.kdfParams.m &&
    left.kdfParams.t === right.kdfParams.t &&
    left.kdfParams.p === right.kdfParams.p
  );
}

export function useChangeRecoveryPin() {
  const utils = trpc.useUtils();
  const mutation = trpc.wallets.rotateEscrow.useMutation();
  const [working, setWorking] = useState(false);

  async function validateCurrentPin(currentPin: string): Promise<boolean> {
    let current: Awaited<ReturnType<typeof api.wallets.getEscrow.query>>;
    try {
      current = await api.wallets.getEscrow.query();
    } catch {
      throw new RecoveryPinChangeError();
    }
    if (!current) throw new RecoveryNotConfiguredError();
    try {
      verifyEscrowPin(current, currentPin);
      return true;
    } catch (cause) {
      if (cause instanceof BadPinError) return false;
      throw cause;
    }
  }

  async function changeRecoveryPin(
    currentPin: string,
    newPin: string,
  ): Promise<void> {
    if (working) return;
    setWorking(true);
    try {
      let current: Awaited<ReturnType<typeof api.wallets.getEscrow.query>>;
      try {
        current = await api.wallets.getEscrow.query();
      } catch {
        throw new RecoveryPinChangeError();
      }
      if (!current) throw new RecoveryNotConfiguredError();

      // PIN verification and master-key re-wrapping both happen locally.
      const replacement = rotateEscrow(current, currentPin, newPin);
      try {
        await mutation.mutateAsync({
          expectedRevision: current.revision,
          escrow: replacement,
        });
      } catch (error) {
        if (errorCode(error) === "CONFLICT") {
          throw new RecoveryRevisionConflictError();
        }
        if (errorCode(error) === "PRECONDITION_FAILED") {
          throw new RecoveryNotConfiguredError();
        }

        // A lost response can hide a successful commit. Confirm the exact
        // replacement before reporting failure or inviting a dangerous retry.
        try {
          const latest = await api.wallets.getEscrow.query();
          if (
            latest?.revision === current.revision + 1 &&
            sameEscrow(latest, replacement)
          ) {
            await utils.wallets.getEscrow.invalidate();
            return;
          }
        } catch {
          // Preserve the original, stable network/server outcome.
        }
        throw new RecoveryPinChangeError();
      }
      await utils.wallets.getEscrow.invalidate();
    } finally {
      setWorking(false);
    }
  }

  return {
    changeRecoveryPin,
    validateCurrentPin,
    isChanging: working || mutation.isPending,
  };
}
