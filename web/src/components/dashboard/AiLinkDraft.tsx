"use client";

import { useRef, useState, useEffect } from "react";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import { linenFieldClass } from "../ui/glass";

type Draft = {
  description: string | null;
  amount: string | null;
  warning: string;
};

export function AiLinkDraft({ onApply }: { onApply: (draft: Draft) => void }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const result = await api.aiDrafts.generate.mutate({ text });
      if (active.current) setDraft(result);
    } catch {
      if (active.current)
        setError(
          "AI drafting is unavailable. Sign in and try again, or fill out the form manually.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-foreground/15 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Draft with AI · Preview
      </summary>
      <div className="mt-3 grid gap-3">
        <label htmlFor="ai-link-request" className="text-sm">
          What are you requesting payment for?
        </label>
        <textarea
          id="ai-link-request"
          value={text}
          disabled={busy}
          maxLength={2000}
          onChange={(event) => {
            setText(event.target.value);
            setDraft(null);
          }}
          placeholder="Request 750 USDC for September design work"
          className={`${linenFieldClass} min-h-20 rounded-lg border p-3 text-sm`}
        />
        <p className="text-xs text-foreground/65">
          Only this text is sent to Olio’s configured AI server. Don’t include
          private keys or sensitive client details. Names and due dates are not
          saved as invoice fields.
        </p>
        <Button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void generate()}
        >
          {busy ? "Drafting…" : "Generate draft"}
        </Button>
        <div aria-live="polite" className="text-sm">
          {error ? <p role="alert">{error}</p> : null}
          {draft ? (
            <div className="grid gap-2">
              <p>
                <strong>Description:</strong>{" "}
                {draft.description || "Enter manually"}
              </p>
              <p>
                <strong>USDC amount:</strong> {draft.amount || "Enter manually"}
              </p>
              <p>{draft.warning}</p>
              <Button
                type="button"
                onClick={() => {
                  onApply(draft);
                  setDraft(null);
                }}
              >
                Use draft in form
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
