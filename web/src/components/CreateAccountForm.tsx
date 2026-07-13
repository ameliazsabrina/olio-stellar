"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { accountPubkeys, getAccount, setStoredUsername } from "../lib/notes";
import { registerUsername, registerUsernameCache } from "../lib/stellar";
import { usernameSchema } from "../server/modules/usernames/usernames.schema";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useWallet } from "./WalletProvider";

const claimInput = z.object({ username: usernameSchema });
type ClaimInput = z.infer<typeof claimInput>;

export function CreateAccountForm({
  onClaimed,
}: {
  onClaimed: (username: string) => void;
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
      // The recoverable master must already be unlocked (WalletProvider derives
      // it on create / after unlock). Registering pubkeys derived from anything
      // else would desync this account from its escrow — the balance-drift bug.
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
    <div className="grid gap-3">
      <h2 className="text-lg font-semibold text-ink text-center">
        Create your account
      </h2>
      <p className="text-sm text-muted-foreground text-center">
        Pick a username. It will become your payment link, like
        olio.xyz/@jimmymcgill.
      </p>
      <form className="grid gap-2" onSubmit={onSubmit}>
        <label htmlFor="username">Username</label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="username"
            className="min-h-11 flex-1"
            placeholder="jimmymcgill"
            maxLength={32}
            {...usernameField}
            onChange={(e) => {
              e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
              usernameField.onChange(e);
            }}
          />
          <Button className="min-h-11" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Working…" : "Claim"}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          3–32 characters. Letters, numbers, underscore.
        </span>
        {errors.username ? (
          <Alert variant="destructive">
            <AlertDescription>{errors.username.message}</AlertDescription>
          </Alert>
        ) : null}
      </form>
    </div>
  );
}
