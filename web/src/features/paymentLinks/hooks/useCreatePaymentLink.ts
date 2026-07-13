"use client";

import { useState } from "react";
import type { CreateLinkInput } from "../../../server/modules/paymentLinks/paymentLinks.schema";
import { api } from "../../../trpc/client";
import type { PaymentLink } from "../types";

export function useCreatePaymentLink() {
  const [isCreating, setIsCreating] = useState(false);

  async function createPaymentLink(
    input: CreateLinkInput,
  ): Promise<PaymentLink> {
    setIsCreating(true);
    try {
      return await api.paymentLinks.create.mutate(input);
    } finally {
      setIsCreating(false);
    }
  }

  return { createPaymentLink, isCreating };
}
