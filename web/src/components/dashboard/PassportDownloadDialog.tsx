"use client";

import { Download, Loader } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadPassportPdf } from "../../lib/passportPdf";
import { qrPngDataUrl } from "../../lib/qrImage";
import { explorerTxUrl } from "../../lib/stellar";
import { cn } from "../../lib/utils";
import { trpc } from "../../trpc/react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenSegmentedClass } from "../ui/glass";
import { useWallet } from "../WalletProvider";

type Detail = "summary" | "full";
type Period = "3m" | "6m" | "12m" | "all";
type PayerMask = "masked" | "full" | "hidden";

export const DETAIL_OPTIONS: [Detail, string][] = [
  ["summary", "Monthly summary"],
  ["full", "Full payment list"],
];
export const PERIOD_OPTIONS: [Period, string][] = [
  ["3m", "3 months"],
  ["6m", "6 months"],
  ["12m", "12 months"],
  ["all", "All time"],
];
const PAYER_OPTIONS: [PayerMask, string][] = [
  ["masked", "Masked"],
  ["full", "Full"],
  ["hidden", "Hidden"],
];

function OptionGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  hint,
}: {
  legend: string;
  options: [T, string][];
  value: T;
  onChange: (next: T) => void;
  hint?: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium text-foreground">
        {legend}
      </legend>
      <div
        className={cn(
          linenSegmentedClass,
          "grid gap-1 p-1",
          options.length === 2
            ? "grid-cols-2"
            : options.length === 3
              ? "grid-cols-3"
              : "grid-cols-2 sm:grid-cols-4",
        )}
      >
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "min-h-9 rounded-lg px-2 py-1.5 text-[13px] leading-[18px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              value === option
                ? "bg-foreground/18 text-foreground ring-1 ring-foreground/25"
                : "text-foreground/65 hover:bg-foreground/8 hover:text-foreground",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </fieldset>
  );
}

export function PassportDownloadDialog({
  open,
  onClose,
  businessId,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
}) {
  const { username } = useWallet();
  const utils = trpc.useUtils();
  const issue = trpc.passport.issueStatement.useMutation();
  const [detail, setDetail] = useState<Detail>("summary");
  const [period, setPeriod] = useState<Period>("12m");
  const [payerMask, setPayerMask] = useState<PayerMask>("masked");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setWorking(true);
    setError(null);
    try {
      const issued = await issue.mutateAsync({
        businessId,
        detail,
        period,
        payerMask,
      });
      const verifyUrl = `${window.location.origin}${issued.verifyPath}`;
      await downloadPassportPdf({
        statement: issued.statement,
        digest: issued.digest,
        verifyUrl,
        username,
        qr: await qrPngDataUrl(verifyUrl),
        txUrl: explorerTxUrl,
      });
      void utils.passport.listStatements.invalidate({ businessId });
      toast.success("Payment statement downloaded");
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The payment statement could not be created.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !working && onClose()}>
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <DialogTitle>Download payment statement</DialogTitle>
          <DialogDescription>
            A PDF of your verified identity and the payments you received, with
            a link anyone can use to check it with Olio.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <OptionGroup
            legend="Detail"
            options={DETAIL_OPTIONS}
            value={detail}
            onChange={setDetail}
          />
          <OptionGroup
            legend="Period"
            options={PERIOD_OPTIONS}
            value={period}
            onChange={setPeriod}
          />
          {detail === "full" ? (
            <OptionGroup
              legend="Payer addresses"
              options={PAYER_OPTIONS}
              value={payerMask}
              onChange={setPayerMask}
              hint={
                payerMask === "masked"
                  ? "Shows the first and last four characters, like GABC…WXYZ."
                  : payerMask === "full"
                    ? "Shows each payer's complete address."
                    : "Leaves payer addresses out of the file."
              }
            />
          ) : null}

          <p className="text-sm leading-6 text-muted-foreground">
            Only people you send this file to will see your payment history.
            Your public badge link stays identity only.
          </p>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            variant="default"
            size="lg"
            className="min-h-11"
            onClick={download}
            disabled={working}
            aria-busy={working}
          >
            {working ? (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            {working ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
