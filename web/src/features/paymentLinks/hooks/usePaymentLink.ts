"use client";

import { useEffect, useState } from "react";
import { api } from "../../../trpc/client";
import type { PaymentLink } from "../types";

export function usePaymentLink(id: string | null) {
  const [link, setLink] = useState<PaymentLink | null>(null);

  useEffect(() => {
    let active = true;
    if (!id) {
      setLink(null);
      return;
    }

    api.paymentLinks.get
      .query({ id })
      .then((nextLink) => {
        if (active) setLink(nextLink);
      })
      .catch(() => {
        if (active) setLink(null);
      });

    return () => {
      active = false;
    };
  }, [id]);

  return link;
}
