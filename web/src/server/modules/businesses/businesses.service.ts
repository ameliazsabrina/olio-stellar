import "server-only";
import { randomBytes } from "node:crypto";
import {
  type BusinessMembershipDoc,
  type BusinessProfileDoc,
  type BusinessRole,
  getBusinessMemberships,
  getBusinessProfiles,
  getIdentityCredentials,
  getVerificationAudit,
  getVerificationCases,
} from "../../db/mongo";
import { usernameByOwner } from "../usernames/usernames.service";
import { currentWallet } from "../wallets/wallets.service";
import {
  BusinessBindingError,
  BusinessForbiddenError,
  BusinessNotFoundError,
  BusinessStoreError,
} from "./businesses.errors";
import type {
  BindAccountOutput,
  BusinessOutput,
  CreateBusinessInput,
  UpdateBusinessProfileInput,
} from "./businesses.schema";

export const MANAGER_ROLES: BusinessRole[] = ["owner", "admin"];

export function newOpaqueId(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number }).code === 11000;
}

export function toBusinessOutput(
  doc: BusinessProfileDoc,
  role: BusinessRole,
): BusinessOutput {
  return {
    businessId: doc._id,
    publicId: doc.publicId,
    type: doc.type,
    lifecycle: doc.lifecycle,
    displayName: doc.displayName,
    username: doc.username,
    accountBound: doc.boundAccount !== null,
    role,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function membershipFor(
  privyUserId: string,
  businessId: string,
): Promise<BusinessMembershipDoc | null> {
  return (await getBusinessMemberships()).findOne({ businessId, privyUserId });
}

export async function assertMember(
  privyUserId: string,
  businessId: string,
): Promise<{ business: BusinessProfileDoc; role: BusinessRole }> {
  const membership = await membershipFor(privyUserId, businessId);
  if (!membership) throw new BusinessNotFoundError();
  const business = await (await getBusinessProfiles()).findOne({
    _id: businessId,
  });
  if (!business) throw new BusinessNotFoundError();
  return { business, role: membership.role };
}

export async function assertManager(
  privyUserId: string,
  businessId: string,
): Promise<{ business: BusinessProfileDoc; role: BusinessRole }> {
  const context = await assertMember(privyUserId, businessId);
  if (!MANAGER_ROLES.includes(context.role)) throw new BusinessForbiddenError();
  return context;
}

type AuthoritativeBinding = {
  boundAccount: string | null;
  username: string | null;
};

export async function authoritativeBinding(
  privyUserId: string,
): Promise<AuthoritativeBinding> {
  const wallet = await currentWallet(privyUserId);
  if (!wallet) return { boundAccount: null, username: null };
  let username: string | null = null;
  try {
    username = await usernameByOwner(wallet.contractId);
  } catch {
    throw new BusinessBindingError(
      "The username registry is unavailable. Try again shortly.",
    );
  }
  return { boundAccount: wallet.contractId, username };
}

export async function recordAudit(entry: {
  actor: string;
  action: string;
  businessId: string;
  caseId?: string | null;
  fromRevision?: number | null;
  toRevision?: number | null;
  reasonCode: string;
}): Promise<void> {
  await (await getVerificationAudit()).insertOne({
    _id: newOpaqueId(16),
    actor: entry.actor,
    action: entry.action,
    caseId: entry.caseId ?? null,
    businessId: entry.businessId,
    fromRevision: entry.fromRevision ?? null,
    toRevision: entry.toRevision ?? null,
    reasonCode: entry.reasonCode,
    at: new Date(),
  });
}

async function ownedBusiness(
  privyUserId: string,
): Promise<{ business: BusinessProfileDoc; role: BusinessRole } | null> {
  const wallet = await currentWallet(privyUserId);
  const profiles = await getBusinessProfiles();
  const bound = wallet ? await profiles.findOne({ boundAccount: wallet.contractId }) : null;
  if (bound) {
    const context = await assertManager(privyUserId, bound._id);
    return context;
  }
  const draft = await profiles.findOne({ createdBy: privyUserId, boundAccount: null });
  return draft ? assertManager(privyUserId, draft._id) : null;
}

export async function createBusiness(
  privyUserId: string,
  input: CreateBusinessInput,
): Promise<BusinessOutput> {
  const existing = await ownedBusiness(privyUserId);
  if (existing) return toBusinessOutput(existing.business, existing.role);

  const binding = await authoritativeBinding(privyUserId);
  const now = new Date();
  const doc: BusinessProfileDoc = {
    _id: newOpaqueId(),
    publicId: newOpaqueId(),
    type: input.type,
    lifecycle: "active",
    displayName: input.displayName,
    username: binding.username,
    boundAccount: binding.boundAccount,
    boundAt: binding.boundAccount ? now : null,
    createdBy: privyUserId,
    createdAt: now,
    updatedAt: now,
  };
  const memberships = await getBusinessMemberships();
  try {
    await memberships.insertOne({
      _id: `${doc._id}:${privyUserId}`,
      businessId: doc._id,
      privyUserId,
      role: "owner",
      createdAt: now,
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const raced = await ownedBusiness(privyUserId);
      if (raced) return toBusinessOutput(raced.business, raced.role);
    }
    throw error;
  }
  try {
    await (await getBusinessProfiles()).insertOne(doc);
  } catch (error) {
    await memberships.deleteOne({ _id: `${doc._id}:${privyUserId}` });
    if (isDuplicateKey(error)) {
      throw new BusinessBindingError(
        "This username is already associated with another business profile.",
      );
    }
    throw new BusinessStoreError();
  }
  await recordAudit({
    actor: privyUserId,
    action: "business.created",
    businessId: doc._id,
    reasonCode: binding.boundAccount ? "bound" : "unbound",
  });
  return toBusinessOutput(doc, "owner");
}

export async function listMine(privyUserId: string): Promise<BusinessOutput[]> {
  const memberships = await (await getBusinessMemberships())
    .find({ privyUserId })
    .sort({ createdAt: 1 })
    .toArray();
  if (memberships.length === 0) return [];
  const profiles = await (await getBusinessProfiles())
    .find({ _id: { $in: memberships.map((m) => m.businessId) } })
    .toArray();
  const byId = new Map(profiles.map((p) => [p._id, p]));
  return memberships.flatMap((membership) => {
    const profile = byId.get(membership.businessId);
    return profile ? [toBusinessOutput(profile, membership.role)] : [];
  });
}

export async function updateProfile(
  privyUserId: string,
  input: UpdateBusinessProfileInput,
): Promise<BusinessOutput> {
  const { role } = await assertManager(privyUserId, input.businessId);
  const updated = await (await getBusinessProfiles()).findOneAndUpdate(
    { _id: input.businessId },
    { $set: { displayName: input.displayName, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) throw new BusinessNotFoundError();
  return toBusinessOutput(updated, role);
}

async function suspendForOwnershipChange(
  privyUserId: string,
  businessId: string,
): Promise<void> {
  const now = new Date();
  await (await getIdentityCredentials()).updateMany(
    { businessId, status: "active" },
    {
      $set: {
        status: "suspended",
        suspensionReason: "ownership_changed",
        published: false,
        updatedAt: now,
      },
    },
  );
  await (await getVerificationCases()).updateMany(
    { businessId, eligibility: "approved" },
    {
      $set: {
        eligibility: "manual_review",
        userMessage:
          "The account linked to this business changed. Verification is being reviewed again.",
        reconcileAt: now,
        updatedAt: now,
      },
      $inc: { revision: 1 },
      $push: { internalReasons: "ownership_changed" },
    },
  );
  await recordAudit({
    actor: privyUserId,
    action: "business.rebound",
    businessId,
    reasonCode: "ownership_changed",
  });
}

export async function bindAccount(
  privyUserId: string,
  businessId: string,
): Promise<BindAccountOutput> {
  const { business, role } = await assertManager(privyUserId, businessId);
  const owner = await (await getBusinessMemberships()).findOne({
    businessId,
    role: "owner",
  });
  if (!owner) throw new BusinessNotFoundError();
  const binding = await authoritativeBinding(owner.privyUserId);
  if (!binding.boundAccount) {
    throw new BusinessBindingError(
      "Finish setting up your Olio account before linking it to a business.",
    );
  }
  const unchanged =
    business.boundAccount === binding.boundAccount &&
    business.username === binding.username;
  if (unchanged) {
    return { business: toBusinessOutput(business, role), changed: false };
  }
  const ownershipChanged =
    business.boundAccount !== null &&
    business.boundAccount !== binding.boundAccount;
  const now = new Date();
  let updated: BusinessProfileDoc | null;
  try {
    updated = await (await getBusinessProfiles()).findOneAndUpdate(
      { _id: businessId, updatedAt: business.updatedAt },
      {
        $set: {
          boundAccount: binding.boundAccount,
          username: binding.username,
          boundAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new BusinessBindingError(
        "This username is already associated with another business profile.",
      );
    }
    throw error;
  }
  if (!updated) throw new BusinessStoreError("The profile changed. Retry.");
  if (ownershipChanged)
    await suspendForOwnershipChange(privyUserId, businessId);
  else
    await recordAudit({
      actor: privyUserId,
      action: "business.bound",
      businessId,
      reasonCode: "bound",
    });
  return { business: toBusinessOutput(updated, role), changed: true };
}

export async function businessOwnsUsername(
  privyUserId: string,
  businessId: string,
  username: string,
): Promise<boolean> {
  const { business } = await assertManager(privyUserId, businessId);
  if (business.lifecycle !== "active") return false;
  if (business.username !== username || !business.boundAccount) return false;
  const binding = await authoritativeBinding(privyUserId);
  return (
    binding.boundAccount === business.boundAccount &&
    binding.username === username
  );
}

export {
  BusinessBindingError,
  BusinessForbiddenError,
  BusinessNotFoundError,
  BusinessStoreError,
};
