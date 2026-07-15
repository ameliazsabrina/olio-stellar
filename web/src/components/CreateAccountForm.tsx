"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { accountPubkeys, getAccount, setStoredUsername } from "../lib/notes";
import { registerUsername, registerUsernameCache } from "../lib/stellar";
import { usernameSchema } from "../server/modules/usernames/usernames.schema";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
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
      <DialogContent appearance="glass" className="max-w-[420px] gap-0">
        <DialogTitle className="text-lg font-semibold text-center">
          Create Your Account
        </DialogTitle>
        <p className="mx-auto mt-2 max-w-[32ch] text-center text-sm leading-4 text-muted-foreground">
          Pick a username. It will become your payment link, like
          olio.xyz/@jimmymcgill.
        </p>

        <form className="mt-6 grid gap-3" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="username">
              Username
            </label>
            <Input
              appearance="glass"
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
            variant="glass"
            className="min-h-11 w-full"
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Working…" : "Claim"}
          </Button>

          <ToastFeedback
            message={errors.username?.message}
            variant="error"
            toastId="create-account-error"
          />
        </form>

        {error ? (
          <p className="mt-4 text-center text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
