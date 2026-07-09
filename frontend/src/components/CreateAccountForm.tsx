"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usernameSchema } from "../server/modules/usernames/usernames.schema";
import { useWallet } from "./WalletProvider";
import { accountPubkeys, ensureAccount, setStoredUsername } from "../lib/notes";
import { registerUsername } from "../lib/stellar";
import { api } from "../trpc/client";
import { btn, field, hint, inline, input, panel, status, sub } from "../lib/ui";

const claimInput = z.object({ username: usernameSchema });
type ClaimInput = z.infer<typeof claimInput>;

export function CreateAccountForm({ onClaimed }: { onClaimed: (username: string) => void }) {
  const { getSigner } = useWallet();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<ClaimInput>({ resolver: zodResolver(claimInput), defaultValues: { username: "" } });

  const usernameField = register("username");

  const onSubmit = handleSubmit(async ({ username }) => {
    try {
      const signer = getSigner();
      const acct = ensureAccount();
      const { notePubkey, viewPubkey } = await accountPubkeys(acct);
      await registerUsername(signer, username, notePubkey, viewPubkey);
      // Mirror the fresh registration into Mongo now. Soft-fail: the on-chain
      // register already succeeded, and the resolve cache self-heals on the
      // next lookup, so a mirror hiccup shouldn't block the claim.
      try {
        await api.usernames.register.mutate({ username });
      } catch (err) {
        console.warn("username saved on-chain but Mongo mirror failed", err);
      }
      setStoredUsername(username);
      onClaimed(username);
    } catch (e) {
      setError("username", { message: e instanceof Error ? e.message : "Registration failed." });
    }
  });

  return (
    <div className={panel}>
      <h2 className="text-lg font-semibold text-ink">Create your account</h2>
      <p className={sub}>Pick a username — it becomes your payment link, like olio/@dinar.</p>
      <form className={field} onSubmit={onSubmit}>
        <label htmlFor="username">Username</label>
        <div className={inline}>
          <input
            id="username"
            className={input}
            placeholder="dinar"
            maxLength={32}
            {...usernameField}
            onChange={(e) => {
              e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
              usernameField.onChange(e);
            }}
          />
          <button className={btn} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Working…" : "Claim"}
          </button>
        </div>
        <span className={hint}>3–32 characters. Letters, numbers, underscore.</span>
        {errors.username ? <div className={status("err")}>{errors.username.message}</div> : null}
      </form>
    </div>
  );
}
