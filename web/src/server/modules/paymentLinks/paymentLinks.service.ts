import "server-only";
import { randomBytes } from "node:crypto";
import type { PaymentLinkDoc } from "../../db/mongo";
import { getPaymentLinks } from "../../db/mongo";
import { PaymentLinkStoreError } from "./paymentLinks.errors";
import type {
  CreateLinkInput,
  LinkOutput,
  ListByOwnerInput,
} from "./paymentLinks.schema";

function newLinkId(): string {
  return randomBytes(9).toString("base64url"); // 12 url-safe chars
}

function toOutput(doc: PaymentLinkDoc): LinkOutput {
  return {
    id: doc._id,
    owner: doc.owner,
    amount: doc.amount,
    label: doc.label,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function createLink(input: CreateLinkInput): Promise<LinkOutput> {
  const links = await getPaymentLinks();
  const doc: PaymentLinkDoc = {
    _id: newLinkId(),
    owner: input.username,
    amount: input.amount ?? null,
    label: input.label ?? null,
    status: "pending",
    createdAt: new Date(),
  };
  const res = await links.insertOne(doc);
  if (!res.acknowledged) throw new PaymentLinkStoreError(doc._id);
  return toOutput(doc);
}

export async function getLink(id: string): Promise<LinkOutput | null> {
  const links = await getPaymentLinks();
  const doc = await links.findOne({ _id: id });
  return doc ? toOutput(doc) : null;
}

export async function listLinksByOwner(
  input: ListByOwnerInput,
): Promise<LinkOutput[]> {
  const links = await getPaymentLinks();
  const docs = await links
    .find({ owner: input.owner })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toOutput);
}

export { PaymentLinkStoreError };
