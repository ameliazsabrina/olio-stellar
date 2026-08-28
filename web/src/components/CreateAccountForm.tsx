"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { accountPubkeys, getAccount, setStoredUsername } from "../lib/notes";
import { registerUsername, registerUsernameCache } from "../lib/stellar";
import { usernameSchema } from "../server/modules/usernames/usernames.schema";
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
import { useWallet } from "./WalletProvider";

const claimInput = z.object({ username: usernameSchema });
type ClaimInput = z.infer<typeof claimInput>;

export function CreateAccountForm({
  open,
  onClose,
  onClaimed,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onClaimed: (username: string) => void;
  error?: string | null;
}) {
  const { getSigner } = useWallet();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClaimInput>({
    resolver: zodResolver(claimInput),
    defaultValues: { username: "" },
  });

  const usernameField = register("username");

  const onSubmit = handleSubmit(async ({ username }) => {
    try {
      const signer = getSigner();
      // Registration must use pubkeys from the unlocked recoverable account so
      // the username stays attached to the same escrow state.
      const acct = getAccount();
      if (!acct) throw new Error("Account is locked. Unlock with your PIN.");
      const { notePubkey, viewPubkey } = await accountPubkeys(acct);
      await registerUsername(signer, username, notePubkey, viewPubkey);
      try {
        await registerUsernameCache(username);
      } catch (err) {
        console.warn("username saved on-chain but Mongo mirror failed", err);
      }
      setStoredUsername(username);
      onClaimed(username);
    } catch (e) {
      setError("username", {
        message: e instanceof Error ? e.message : "Registration failed.",
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent appearance="linen" size="sm">
        <DialogHeader className="px-10 text-center">
          <DialogTitle>Create Your Account</DialogTitle>
          <DialogDescription className="mx-auto">
            Pick a username. It will become your payment link, like
            olio.xyz/@jimmymcgill.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="username">
              Username
            </label>
            <Input
              appearance="linen"
              id="username"
              className="min-h-11"
              placeholder="jimmymcgill"
              maxLength={32}
              {...usernameField}
              onChange={(e) => {
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
                usernameField.onChange(e);
              }}
            />
            <span className="text-xs text-muted-foreground">
              3-32 characters. Letters, numbers, underscore.
            </span>
          </div>

          <Button
            variant="default"
            className="min-h-11 w-full"
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {isSubmitting ? "Working…" : "Claim"}
          </Button>

          <ToastFeedback
            message={errors.username?.message}
            variant="error"
            toastId="create-account-error"
          />
        </form>

        <ToastFeedback
          title="Could not create account"
          message={error}
          variant="error"
          toastId="create-account-submit-error"
        />
      </DialogContent>
    </Dialog>
  );
}
