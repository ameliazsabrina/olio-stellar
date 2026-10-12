import "server-only";
import { randomBytes } from "node:crypto";
import { bytesToHex } from "../../../lib/crypto";
import type { SignedFeeQuote } from "../../../lib/fee-quote";
import { intentQuoteId } from "../../../lib/invoiceCrypto";
import { poolId, stellarNetwork } from "../../../lib/stellar";
import {
  getBusinessProfiles,
  getPaymentIntents,
  getQuoteContexts,
  type InvoiceDoc,
  type InvoiceVersionDoc,
  type PaymentIntentDoc,
} from "../../db/mongo";
import { newOpaqueId } from "../businesses/businesses.service";
import { payableInvoice } from "../invoices/invoices.service";
import { FeePolicyUnavailableError } from "./feeQuotes.errors";

export type IntentBinding = {
  invoice: InvoiceDoc;
  version: InvoiceVersionDoc;
  intentNonce: Uint8Array;
  quoteId: Uint8Array;
};

export async function bindInvoiceIntent(
  invoice: { invoiceId: string; version: number },
  recipientOwner: string,
): Promise<IntentBinding> {
  const payable = await payableInvoice(
    invoice.invoiceId,
    invoice.version,
    recipientOwner,
  );
  const intentNonce = new Uint8Array(randomBytes(32));
  return {
    invoice: payable.head,
    version: payable.version,
    intentNonce,
    quoteId: intentQuoteId(payable.version.invoiceCommitment, intentNonce),
  };
}

export async function recordQuoteAttribution(input: {
  quote: SignedFeeQuote;
  recipient: { owner: string; notePubkey: Uint8Array; viewPubkey: Uint8Array };
  binding: IntentBinding | null;
  sourceDomain: number;
}): Promise<void> {
  const quoteId = bytesToHex(input.quote.quoteId);
  const commitment = bytesToHex(input.quote.commitment);
  const now = new Date();
  try {
    const business = await (await getBusinessProfiles()).findOne({
      boundAccount: input.recipient.owner,
      lifecycle: "active",
    });
    let intentId: string | null = null;
    if (input.binding) {
      const intent: PaymentIntentDoc = {
        _id: newOpaqueId(),
        invoiceId: input.binding.invoice._id,
        invoiceVersion: input.binding.version.version,
        invoiceCommitment: input.binding.version.invoiceCommitment,
        intentNonce: bytesToHex(input.binding.intentNonce),
        quoteId,
        businessId: input.binding.invoice.businessId,
        noteCommitment: commitment,
        amount: input.quote.paymentAmount,
        channel: input.quote.channel,
        state: "open",
        expiresAt: new Date(Number(input.quote.expiresAt) * 1000),
        railRefs:
          input.quote.channel === "cctp"
            ? { sourceDomain: input.sourceDomain }
            : {},
        settlementId: null,
        settledAt: null,
        createdAt: now,
      };
      await (await getPaymentIntents()).insertOne(intent, {
        writeConcern: { w: "majority", j: true },
      });
      intentId = intent._id;
    }
    await (await getQuoteContexts()).insertOne(
      {
        _id: quoteId,
        channel: input.quote.channel,
        network: stellarNetwork,
        poolId,
        recipientOwner: input.recipient.owner,
        businessId: input.binding?.invoice.businessId ?? business?._id ?? null,
        notePubkey: bytesToHex(input.recipient.notePubkey),
        viewPubkey: bytesToHex(input.recipient.viewPubkey),
        commitment,
        paymentAmount: input.quote.paymentAmount,
        intentId,
        settlementId: null,
        source: "issue",
        createdAt: now,
      },
      { writeConcern: { w: "majority", j: true } },
    );
  } catch {
    throw new FeePolicyUnavailableError(
      "Unable to record payment attribution. Try again.",
    );
  }
}
