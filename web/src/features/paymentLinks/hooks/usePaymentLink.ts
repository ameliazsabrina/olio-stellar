"use client";

import { trpc } from "../../../trpc/react";
import type { PaymentLink } from "../types";

type LinkState = {
  link: PaymentLink | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

export function usePaymentLink(id: string | null): LinkState {
  const query = trpc.paymentLinks.get.useQuery(
    { id: id ?? "" },
    { enabled: !!id },
  );
  return {
    link: id ? (query.data ?? null) : null,
    loading: !!id && query.isPending,
    error: id ? (query.error?.message ?? null) : null,
    retry: () => void query.refetch(),
  };
}

export function usePaymentLinkBySlug(
  owner: string,
  slug: string | null,
): LinkState {
  const query = trpc.paymentLinks.resolve.useQuery(
    { owner, slug: slug ?? "" },
    { enabled: !!owner && !!slug },
  );
  const enabled = !!owner && !!slug;
  return {
    link: enabled ? (query.data ?? null) : null,
    loading: enabled && query.isPending,
    error: enabled ? (query.error?.message ?? null) : null,
    retry: () => void query.refetch(),
  };
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
    error: query.error?.message ?? null,
    refresh,
    setLinks,
  };
}
