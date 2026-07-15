import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MongoServerError } from "mongodb";
import type { PaymentLinkDoc } from "../../db/mongo";
import { getPaymentLinks } from "../../db/mongo";
import {
  PaymentLinkSlugUnavailableError,
  PaymentLinkStoreError,
  PaymentLinkUnauthorizedError,
} from "./paymentLinks.errors";
import type {
  ArchiveLinkInput,
  CreateLinkInput,
  CreateLinkResult,
  DeleteLinkInput,
  LinkOutput,
  ListByOwnerInput,
  ResolveLinkInput,
  UpdateLinkInput,
} from "./paymentLinks.schema";

function newLinkId(): string {
  return randomBytes(9).toString("base64url"); // 12 url-safe chars
}

function newManageToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Constant-time compare of the presented token against the stored hash.
// Missing hash (legacy links) is treated as unauthorized, not an error path.
function assertManageAuthorized(
  doc: PaymentLinkDoc | null,
  token: string,
): asserts doc is PaymentLinkDoc {
  if (!doc?.manageTokenHash) throw new PaymentLinkUnauthorizedError();
  const presented = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(doc.manageTokenHash, "hex");
  if (
    presented.length !== stored.length ||
    !timingSafeEqual(presented, stored)
  ) {
    throw new PaymentLinkUnauthorizedError();
  }
}

function toOutput(doc: PaymentLinkDoc): LinkOutput {
  const description = doc.description ?? doc.label ?? null;
  return {
    id: doc._id,
    owner: doc.owner,
    slug: doc.slug ?? doc._id,
    amount: doc.amount,
    description,
    label: description,
    status: doc.status,
    state: doc.state ?? "active",
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt?.toISOString() ?? null,
    archivedAt: doc.archivedAt?.toISOString() ?? null,
  };
}

export async function createLink(
  input: CreateLinkInput,
): Promise<CreateLinkResult> {
  const links = await getPaymentLinks();
  const now = new Date();
  const manageToken = newManageToken();
  const doc: PaymentLinkDoc = {
    _id: newLinkId(),
    owner: input.username,
    slug: input.slug,
    amount: input.amount ?? null,
    description: input.description ?? null,
    label: input.description ?? null,
    state: "active",
    status: "pending",
    manageTokenHash: hashToken(manageToken),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  try {
    const res = await links.insertOne(doc);
    if (!res.acknowledged) throw new PaymentLinkStoreError(doc._id);
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      throw new PaymentLinkSlugUnavailableError(input.slug);
    }
    throw e;
  }
  return { ...toOutput(doc), manageToken };
}

export async function getLink(id: string): Promise<LinkOutput | null> {
  const links = await getPaymentLinks();
  const doc = await links.findOne({
    _id: id,
    $or: [{ state: "active" }, { state: { $exists: false } }],
  });
  return doc ? toOutput(doc) : null;
}

export async function resolveLink(
  input: ResolveLinkInput,
): Promise<LinkOutput | null> {
  const links = await getPaymentLinks();
  const doc = await links.findOne({
    owner: input.owner,
    slug: input.slug,
    state: "active",
  });
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

export async function updateLink(input: UpdateLinkInput): Promise<LinkOutput> {
  const links = await getPaymentLinks();
  const doc = await links.findOne({ _id: input.id });
  assertManageAuthorized(doc, input.manageToken);
  const res = await links.findOneAndUpdate(
    { _id: input.id },
    {
      $set: {
        amount: input.amount ?? null,
        description: input.description ?? null,
        label: input.description ?? null,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!res) throw new PaymentLinkStoreError(input.id);
  return toOutput(res);
}

export async function setLinkArchived(
  input: ArchiveLinkInput,
): Promise<LinkOutput> {
  const links = await getPaymentLinks();
  const now = new Date();
  const doc = await links.findOne({ _id: input.id });
  assertManageAuthorized(doc, input.manageToken);
  const res = await links.findOneAndUpdate(
    { _id: input.id },
    {
      $set: {
        state: input.archived ? "archived" : "active",
        archivedAt: input.archived ? now : null,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!res) throw new PaymentLinkStoreError(input.id);
  return toOutput(res);
}

export async function deleteLink(input: DeleteLinkInput): Promise<boolean> {
  const links = await getPaymentLinks();
  const doc = await links.findOne({ _id: input.id });
  assertManageAuthorized(doc, input.manageToken);
  const res = await links.deleteOne({ _id: input.id });
  return res.deletedCount === 1;
}

function isDuplicateKeyError(e: unknown): e is MongoServerError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === 11000
  );
}

export {
  PaymentLinkSlugUnavailableError,
  PaymentLinkStoreError,
  PaymentLinkUnauthorizedError,
};
