import "server-only";
import {
  type BusinessProfileDoc,
  getIdentityCredentials,
  type IdentityCredentialDoc,
} from "../../db/mongo";
import { assertMember } from "../businesses/businesses.service";
import {
  type VerificationConfig,
  verificationConfig,
} from "../verification/verification.config";
import { credentialSummary } from "../verification/verification.service";
import type { IdentityPreviewOutput } from "./passport.schema";

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
  now = new Date(),
): IdentityPreviewOutput {
  return {
    businessId: business._id,
    publicId: business.publicId,
    displayName: business.displayName,
    type: business.type,
    credential: credentialSummary(credential, now),
  };
}

export async function identityPreview(
  privyUserId: string,
  businessId: string,
  config = verificationConfig(),
): Promise<IdentityPreviewOutput> {
  const { business } = await assertMember(privyUserId, businessId);
  return buildPreview(business, await credentialFor(businessId, config));
}
