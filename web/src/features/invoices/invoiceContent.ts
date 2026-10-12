import { z } from "zod";
import { fromBaseUnits, toBaseUnits } from "../../lib/crypto";
import {
  contentCommitment,
  decryptInvoice,
  encryptInvoice,
  type InvoiceContent,
  invoiceTotal,
  newInvoiceSalt,
  unwrapKey,
  wrapKeyToView,
} from "../../lib/invoiceCrypto";

const I64_MAX = (1n << 63n) - 1n;

export const invoiceFormSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(1, "Enter the customer's name.")
    .max(120, "Use 120 characters or fewer."),
  customerEmail: z.union([
    z.literal(""),
    z.string().trim().email("Enter a valid email address.").max(200),
  ]),
  customerAddress: z.string().trim().max(500, "Use 500 characters or fewer."),
  dueDate: z.union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid due date."),
  ]),
  notes: z.string().trim().max(1000, "Use 1000 characters or fewer."),
  lineItems: z
    .array(
      z.object({
        description: z
          .string()
          .trim()
          .min(1, "Describe each line item.")
          .max(200, "Use 200 characters or fewer."),
        quantity: z
          .string()
          .trim()
          .regex(/^[1-9]\d{0,5}$/, "Use a whole quantity of at least 1."),
        unitPrice: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,7})?$/, "Enter a valid USDC amount."),
      }),
    )
    .min(1, "Add at least one line item.")
    .max(50, "Use 50 line items or fewer."),
});

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

export const emptyLineItem = { description: "", quantity: "1", unitPrice: "" };

export function emptyInvoiceForm(): InvoiceFormValues {
  return {
    customerName: "",
    customerEmail: "",
    customerAddress: "",
    dueDate: "",
    notes: "",
    lineItems: [{ ...emptyLineItem }],
  };
}

export function formToContent(
  values: InvoiceFormValues,
  salt = newInvoiceSalt(),
): InvoiceContent {
  return {
    customer: {
      name: values.customerName.trim(),
      email: values.customerEmail.trim() || null,
      address: values.customerAddress.trim() || null,
    },
    lineItems: values.lineItems.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPrice: toBaseUnits(item.unitPrice).toString(),
    })),
    notes: values.notes.trim() || null,
    salt,
  };
}

export function contentToForm(
  content: InvoiceContent,
  dueAt: string | null,
): InvoiceFormValues {
  return {
    customerName: content.customer.name,
    customerEmail: content.customer.email ?? "",
    customerAddress: content.customer.address ?? "",
    dueDate: dueAt ? dueAt.slice(0, 10) : "",
    notes: content.notes ?? "",
    lineItems: content.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: fromBaseUnits(BigInt(item.unitPrice)),
    })),
  };
}

export function formTotal(values: InvoiceFormValues): bigint | null {
  try {
    return invoiceTotal(
      values.lineItems.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity) || 0,
        unitPrice: /^\d+(\.\d{1,7})?$/.test(item.unitPrice.trim())
          ? toBaseUnits(item.unitPrice).toString()
          : "0",
      })),
    );
  } catch {
    return null;
  }
}

export function dueDateToIso(date: string): string | null {
  return date ? `${date}T23:59:59.000Z` : null;
}

export type SealedInvoice = {
  amountDue: string;
  encryptedContent: string;
  wrappedKey: string;
  contentCommitment: string;
};

export function sealInvoice(
  content: InvoiceContent,
  key: Uint8Array,
  viewPubkey: Uint8Array,
): SealedInvoice {
  const amount = invoiceTotal(content.lineItems);
  if (amount <= 0n) throw new Error("The invoice total must be above zero.");
  if (amount > I64_MAX) throw new Error("The invoice total is too large.");
  return {
    amountDue: amount.toString(),
    encryptedContent: encryptInvoice(content, key),
    wrappedKey: wrapKeyToView(key, viewPubkey),
    contentCommitment: contentCommitment(content),
  };
}

export type OpenedInvoice = { key: Uint8Array; content: InvoiceContent };

export function openInvoice(
  version: { encryptedContent: string | null; wrappedKey: string | null },
  viewSk: Uint8Array | null,
): OpenedInvoice | null {
  if (!viewSk || !version.encryptedContent || !version.wrappedKey) return null;
  try {
    const key = unwrapKey(version.wrappedKey, viewSk);
    return { key, content: decryptInvoice(version.encryptedContent, key) };
  } catch {
    return null;
  }
}

export function contentMatches(
  content: InvoiceContent,
  expectedCommitment: string,
): boolean {
  try {
    return contentCommitment(content) === expectedCommitment;
  } catch {
    return false;
  }
}

export function keyedItems<T>(
  items: T[],
  identity: (item: T) => string,
): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = identity(item);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { key: `${base}#${occurrence}`, item };
  });
}

export const lineItemIdentity = (item: {
  description: string;
  quantity: number;
  unitPrice: string;
}) => `${item.description}:${item.quantity}:${item.unitPrice}`;
