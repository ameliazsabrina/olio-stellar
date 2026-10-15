"use client";

import { ShieldCheck } from "lucide-react";
import { DashboardPageHeader } from "../../../components/dashboard/DashboardPageHeader";
import type { PaymentLink } from "../../../features/paymentLinks/types";
import type { OlioAccount } from "../../../lib/stellar";
import { PayForm } from "./PayForm";

export function PayContent({
  account,
  username,
  link,
}: {
  account: OlioAccount;
  username: string;
  link?: PaymentLink | null;
}) {
  return (
    <>
      <DashboardPageHeader
        className="mb-0"
        title={`Pay @${username}`}
        description="Your payment becomes a confidential note only the recipient can discover and spend."
      />

      <PayForm account={account} username={username} link={link} />

      <p className="flex items-center justify-center gap-2 pt-4 text-center text-xs leading-[1.0625rem] text-brand-linen/60">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
        Unlinkable receipt · encrypted to the recipient · Built on Stellar
      </p>
    </>
  );
}
