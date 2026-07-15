"use client";

import { trpc } from "../../../trpc/react";
import type { PaymentLink } from "../types";

type LinkState = PaymentLink | null | "loading";

export function usePaymentLink(id: string | null): LinkState {
  const query = trpc.paymentLinks.get.useQuery(
    { id: id ?? "" },
    { enabled: !!id },
  );
  if (!id) return null;
  if (query.isPending) return "loading";
  return query.data ?? null;
}

export function usePaymentLinkBySlug(
  owner: string,
  slug: string | null,
): LinkState {
  const query = trpc.paymentLinks.resolve.useQuery(
    { owner, slug: slug ?? "" },
    { enabled: !!owner && !!slug },
  );
  if (!owner || !slug) return null;
  if (query.isPending) return "loading";
  return query.data ?? null;
}

export function usePaymentLinksByOwner(owner: string | null) {
  const utils = trpc.useUtils();
  const query = trpc.paymentLinks.listByOwner.useQuery(
    { owner: owner ?? "" },
    { enabled: !!owner },
  );

  function refresh(): Promise<void> {
    if (!owner) return Promise.resolve();
    return utils.paymentLinks.listByOwner.invalidate({ owner });
  }

  function setLinks(updater: (current: PaymentLink[]) => PaymentLink[]): void {
    if (!owner) return;
    utils.paymentLinks.listByOwner.setData({ owner }, (current) =>
      updater(current ?? []),
    );
  }

  return {
    links: query.data ?? [],
    loading: !!owner && query.isPending,
    refresh,
    setLinks,
  };
}
