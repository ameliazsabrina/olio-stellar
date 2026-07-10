"use client";

import { ArrowLeft, AtSign, Check, Link2, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { fromBaseUnits, toBaseUnits } from "../../lib/crypto";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import { type OlioAccount, resolveUsername } from "../../lib/stellar";
import { largestNote, sendTransfer, type TransferResult } from "../../lib/transfer";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { useWallet } from "../WalletProvider";

type Method = "username" | "link";
type Step = "method" | "recipient" | "review" | "sending" | "done";

/// Extract an olio username from a raw input: a bare `name`, `@name`, or a pay
/// link/QR payload containing `/pay/<name>`.
function parseUsername(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const inLink = s.match(/\/pay\/([a-zA-Z0-9_]+)/);
  if (inLink) return inLink[1].toLowerCase();
  const bare = s.replace(/^@/, "");
  return /^[a-z0-9_]{3,32}$/i.test(bare) ? bare.toLowerCase() : null;
}

export function SendDialog({
  open,
  onClose,
  notes,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  notes: MyNote[];
  onSuccess: () => void;
}) {
  const { getSigner } = useWallet();
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method>("username");
  const [entry, setEntry] = useState("");
  const [recipient, setRecipient] = useState<OlioAccount | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [amount, setAmount] = useState("");
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);

  const maxSendable = largestNote(notes);

  function reset() {
    setStep("method");
    setMethod("username");
    setEntry("");
    setRecipient(null);
    setRecipientName("");
    setAmount("");
    setLooking(false);
    setError(null);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function chooseMethod(m: Method) {
    setMethod(m);
    setError(null);
    setStep("recipient");
  }

  async function lookup() {
    setError(null);
    const username = parseUsername(entry);
    if (!username) {
      setError(
        method === "link"
          ? "That doesn't look like an Olio pay link."
          : "Enter a valid username (3–32 letters, numbers, or _).",
      );
      return;
    }
    setLooking(true);
    try {
      const acct = await resolveUsername(username);
      if (!acct) {
        setError(`No Olio account found for @${username}.`);
        return;
      }
      setRecipient(acct);
      setRecipientName(username);
    } catch {
      setError("Lookup failed. Check your connection and try again.");
    } finally {
      setLooking(false);
    }
  }

  const units = amount ? toBaseUnits(amount) : 0n;
  const amountValid = units > 0n && units <= maxSendable;

  async function confirm() {
    if (!recipient) return;
    setError(null);
    setStep("sending");
    try {
      const acct = getAccount();
      if (!acct) throw new Error("No local account found on this device.");
      const scan = await scanMyNotes(acct);
      const res = await sendTransfer({
        signer: getSigner(),
        acct,
        scan,
        recipient,
        amount: units,
      });
      setResult(res);
      setStep("done");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transfer failed.");
      setStep("review");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="flex items-center gap-2">
          {step !== "method" && step !== "done" && step !== "sending" && (
            <button
              type="button"
              onClick={() =>
                step === "review" ? setStep("recipient") : setStep("method")
              }
              className="text-muted-text hover:text-ink"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          Send privately
        </DialogTitle>

        {/* Step: choose method */}
        {step === "method" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-text">
              How do you want to reach them?
            </p>
            <button
              type="button"
              onClick={() => chooseMethod("username")}
              className="flex items-center gap-3 rounded-lg border border-line bg-white/60 px-4 py-3 text-left transition-colors hover:border-olive/40 hover:bg-sage/40"
            >
              <AtSign className="size-5 text-olive" />
              <div>
                <div className="text-sm font-medium text-ink">By username</div>
                <div className="text-xs text-muted-text">
                  Search an @username on Olio
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => chooseMethod("link")}
              className="flex items-center gap-3 rounded-lg border border-line bg-white/60 px-4 py-3 text-left transition-colors hover:border-olive/40 hover:bg-sage/40"
            >
              <Link2 className="size-5 text-olive" />
              <div>
                <div className="text-sm font-medium text-ink">
                  Paste a link or QR
                </div>
                <div className="text-xs text-muted-text">
                  Use a shared Olio pay link
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Step: recipient + amount */}
        {step === "recipient" && (
          <div className="grid gap-3">
            {!recipient ? (
              <>
                <label htmlFor="send-entry" className="text-sm text-ink">
                  {method === "link" ? "Pay link" : "Username"}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="send-entry"
                    className="min-h-11 flex-1"
                    placeholder={
                      method === "link" ? "https://…/pay/alice" : "@alice"
                    }
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && lookup()}
                    autoFocus
                  />
                  <Button
                    className="min-h-11"
                    size="lg"
                    onClick={lookup}
                    disabled={looking || !entry.trim()}
                  >
                    {looking ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      "Look up"
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 rounded-lg border border-olive/30 bg-sage/40 px-3 py-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-olive-deep text-sm font-semibold text-paper">
                    {recipientName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      @{recipientName}
                    </div>
                    <div className="text-xs text-muted-text">
                      Verified Olio account
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRecipient(null);
                      setEntry("");
                    }}
                  >
                    Change
                  </Button>
                </div>

                <label htmlFor="send-amount" className="text-sm text-ink">
                  Amount (USDC)
                </label>
                <Input
                  id="send-amount"
                  className="min-h-11"
                  inputMode="decimal"
                  placeholder="5.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                <div className="text-xs text-muted-text">
                  You can send up to {fromBaseUnits(maxSendable)} USDC from a
                  single note.
                </div>
                {amount && !amountValid && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {units <= 0n
                        ? "Enter an amount greater than zero."
                        : "No single note covers this amount. Send a smaller amount or receive more first."}
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  className="min-h-11"
                  size="lg"
                  disabled={!amountValid}
                  onClick={() => {
                    setError(null);
                    setStep("review");
                  }}
                >
                  Review
                </Button>
              </>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Step: review */}
        {step === "review" && recipient && (
          <div className="grid gap-4">
            <div className="rounded-lg border border-line bg-white/60 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-text">Sending</span>
                <span className="font-heading text-2xl font-semibold text-ink">
                  {amount} USDC
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm text-muted-text">To</span>
                <span className="text-sm font-medium text-ink">
                  @{recipientName}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-sage/50 px-3 py-2.5 text-xs text-olive-deep">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-olive" />
              <span>
                Private transfer — the amount stays hidden on-chain, and your
                change comes back to you as a new private note.
              </span>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button className="min-h-11" size="lg" onClick={confirm}>
              Confirm &amp; send
            </Button>
          </div>
        )}

        {/* Step: sending */}
        {step === "sending" && (
          <div className="grid place-items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-olive" />
            <div className="text-sm font-medium text-ink">
              Generating proof &amp; sending…
            </div>
            <div className="text-xs text-muted-text">
              Building a zero-knowledge proof in your browser. This can take a
              few seconds.
            </div>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && result && (
          <div className="grid place-items-center gap-3 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-ok/15 text-ok">
              <Check className="size-6" />
            </div>
            <div className="font-heading text-lg font-semibold text-ink">
              Sent {amount} USDC to @{recipientName}
            </div>
            <div className="text-xs text-muted-text">
              Private note #{result.recipientIndex} delivered · proof took{" "}
              {(result.provingMs / 1000).toFixed(1)}s
            </div>
            <Button className="mt-2 min-h-11" size="lg" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
