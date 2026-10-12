import { Badge } from "../ui/badge";

export type InvoiceStateValue =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "void";

const LABELS: Record<InvoiceStateValue, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
  void: "Void",
};

const VARIANTS: Record<
  InvoiceStateValue,
  "muted" | "neutral" | "warning" | "success" | "danger"
> = {
  draft: "muted",
  issued: "neutral",
  partially_paid: "warning",
  paid: "success",
  cancelled: "danger",
  void: "muted",
};

export function invoiceStateLabel(state: InvoiceStateValue): string {
  return LABELS[state];
}

export function InvoiceStateBadge({
  state,
  appearance = "default",
}: {
  state: InvoiceStateValue;
  appearance?: "default" | "glass";
}) {
  return (
    <Badge appearance={appearance} variant={VARIANTS[state]}>
      {LABELS[state]}
    </Badge>
  );
}
