import "server-only";
import {
  type BusinessProfileDoc,
  getBusinessProfiles,
  getIdentityCredentials,
  type IdentityCredentialDoc,
} from "../../db/mongo";
import {
  assertManager,
  assertMember,
  recordAudit,
} from "../businesses/businesses.service";
import {
  credentialEnvironmentAllowed,
  type VerificationConfig,
  verificationConfig,
} from "../verification/verification.config";
import { VerificationStateError } from "../verification/verification.errors";
import { credentialIsCurrent } from "../verification/verification.policy";
import { credentialSummary } from "../verification/verification.service";
import type {
  IdentityPreviewOutput,
  PublicIdentityOutput,
} from "./passport.schema";

export const PUBLIC_IDENTITY_PATH = "/business";

export function publicPathFor(publicId: string): string {
  return `${PUBLIC_IDENTITY_PATH}/${publicId}`;
}

export function credentialPublishable(
  credential: IdentityCredentialDoc | null,
  config: VerificationConfig,
  now: Date,
): credential is IdentityCredentialDoc {
  return Boolean(
    credential &&
      credentialIsCurrent(credential, now) &&
      credentialEnvironmentAllowed(credential.environment, config),
  );
}

async function credentialFor(
  businessId: string,
  config: VerificationConfig,
): Promise<IdentityCredentialDoc | null> {
  if (!config.environment) return null;
  return (await getIdentityCredentials()).findOne({
    businessId,
    environment: config.environment,
  });
}

export function buildPreview(
  business: BusinessProfileDoc,
  credential: IdentityCredentialDoc | null,
  config: VerificationConfig,
  now = new Date(),
): IdentityPreviewOutput {
  const publishable =
    business.lifecycle === "active" &&
    credentialPublishable(credential, config, now);
  const published = publishable && credential.published;
  return {
    businessId: business._id,
    publicId: business.publicId,
    displayName: business.displayName,
    type: business.type,
    credential: credentialSummary(credential, now),
    publishable,
    publicPath: published ? publicPathFor(business.publicId) : null,
  };
}

export async function identityPreview(
  privyUserId: string,
  businessId: string,
  config = verificationConfig(),
): Promise<IdentityPreviewOutput> {
  const { business } = await assertMember(privyUserId, businessId);
  return buildPreview(
    business,
    await credentialFor(businessId, config),
    config,
  );
}

export async function setVisibility(
  privyUserId: string,
  businessId: string,
  published: boolean,
  config = verificationConfig(),
): Promise<IdentityPreviewOutput> {
  const { business } = await assertManager(privyUserId, businessId);
  const credential = await credentialFor(businessId, config);
  const now = new Date();
  if (published && !credentialPublishable(credential, config, now)) {
    throw new VerificationStateError("not_publishable");
  }
  if (!credential) return buildPreview(business, null, config, now);
  const updated = await (await getIdentityCredentials()).findOneAndUpdate(
    { _id: credential._id, status: credential.status },
    {
      $set: {
        published,
        publishedAt: published ? (credential.publishedAt ?? now) : null,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new VerificationStateError("revision_conflict");
  await recordAudit({
    actor: privyUserId,
    action: published ? "passport.published" : "passport.unpublished",
    businessId,
    caseId: credential.caseId,
    reasonCode: "consent",
  });
  return buildPreview(business, updated, config, now);
}

export function buildPublicIdentity(
  business: BusinessProfileDoc,
  credential: IdentityCredentialDoc | null,
  config: VerificationConfig,
  now = new Date(),
): PublicIdentityOutput {
  if (business.lifecycle !== "active") return null;
  if (!credentialPublishable(credential, config, now)) return null;
  if (!credential.published) return null;
  return {
    publicId: business.publicId,
    displayName: business.displayName,
    type: business.type,
    verified: true,
    issuer: "olio",
    scope: "identity",
    policyVersion: credential.policyVersion,
    checkedAt: credential.checkedAt.toISOString(),
    validUntil: credential.validUntil.toISOString(),
  };
}

export async function publicIdentity(
  publicId: string,
  config = verificationConfig(),
): Promise<PublicIdentityOutput> {
  const business = await (await getBusinessProfiles()).findOne({ publicId });
  if (!business) return null;
  return buildPublicIdentity(
    business,
    await credentialFor(business._id, config),
    config,
  );
}

export async function publishedPublicIdsFor(
  businessIds: string[],
  config = verificationConfig(),
  now = new Date(),
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (businessIds.length === 0 || !config.environment) return result;
  const businesses = await (await getBusinessProfiles())
    .find({ _id: { $in: businessIds }, lifecycle: "active" })
    .toArray();
  const credentials = await (await getIdentityCredentials())
    .find({
      businessId: { $in: businessIds },
      environment: config.environment,
      published: true,
      status: "active",
    })
    .toArray();
  const byBusiness = new Map(credentials.map((c) => [c.businessId, c]));
  for (const business of businesses) {
    const credential = byBusiness.get(business._id) ?? null;
    if (credentialPublishable(credential, config, now)) {
      result.set(business._id, business.publicId);
    }
  }
  return result;
}
