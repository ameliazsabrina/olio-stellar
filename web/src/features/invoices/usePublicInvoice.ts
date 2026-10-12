"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  contentCommitment,
  decryptInvoice,
  type InvoiceContent,
  keyFromFragment,
} from "../../lib/invoiceCrypto";
import type { RouterOutputs } from "../../server/root";
import { api } from "../../trpc/client";

type PublicInvoice = NonNullable<RouterOutputs["invoices"]["publicView"]>;

export function usePublicInvoice(invoiceId: string | null) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(Boolean(invoiceId));
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<Uint8Array | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const read = () => setKey(keyFromFragment(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const load = useCallback((id: string | null) => {
    requestRef.current += 1;
    const request = requestRef.current;
    const current = () => requestRef.current === request;
    if (!id) {
      setInvoice(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.invoices.publicView
      .query({ invoiceId: id })
      .then((value) => {
        if (current()) setInvoice(value);
      })
      .catch((cause) => {
        if (!current()) return;
        setInvoice(null);
        setError(
          cause instanceof Error ? cause.message : "Invoice is unavailable.",
        );
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(invoiceId);
    return () => {
      requestRef.current += 1;
    };
  }, [invoiceId, load]);

  const decrypted = useMemo((): {
    content: InvoiceContent | null;
    mismatch: boolean;
  } => {
    if (!key || !invoice?.encryptedContent)
      return { content: null, mismatch: false };
    try {
      const content = decryptInvoice(invoice.encryptedContent, key);
      return contentCommitment(content) === invoice.contentCommitment
        ? { content, mismatch: false }
        : { content: null, mismatch: true };
    } catch {
      return { content: null, mismatch: true };
    }
  }, [key, invoice]);

  const refetch = useCallback(() => load(invoiceId), [invoiceId, load]);

  return {
    invoice,
    content: decrypted.content,
    keyPresent: key !== null,
    mismatch: decrypted.mismatch,
    loading,
    error,
    refetch,
  };
}
