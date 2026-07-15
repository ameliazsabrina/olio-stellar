"use client";

import type { z } from "zod";
import type { createLinkInput } from "../../../server/modules/paymentLinks/paymentLinks.schema";
import { trpc } from "../../../trpc/react";
import type { PaymentLink } from "../types";

type CreatePaymentLinkInput = z.input<typeof createLinkInput>;

export function useCreatePaymentLink() {
  const utils = trpc.useUtils();
  const mutation = trpc.paymentLinks.create.useMutation({
    onSuccess: (link) => {
      utils.paymentLinks.listByOwner.invalidate({ owner: link.owner });
    },
  });

  function createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<PaymentLink> {
    return mutation.mutateAsync(input);
  }

  return { createPaymentLink, isCreating: mutation.isPending };
}
