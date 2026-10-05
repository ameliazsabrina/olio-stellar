import "server-only";
import { TRPCError } from "@trpc/server";
import { getBusinessProfiles, getVerificationCases } from "../../db/mongo";
import {
  assertManager,
  toBusinessOutput,
} from "../businesses/businesses.service";
import { currentWallet } from "../wallets/wallets.service";
import { readiness, verificationConfig } from "./verification.config";
import { verificationStatus } from "./verification.service";

import { SUBMISSION_REQUIRED } from "../../../lib/verification-onboarding";
export { SUBMISSION_REQUIRED } from "../../../lib/verification-onboarding";
export async function boundBusiness(privyUserId: string) {
  const wallet = await currentWallet(privyUserId);
  if (!wallet) return null;
  const business = await (await getBusinessProfiles()).findOne({
    boundAccount: wallet.contractId,
    lifecycle: "active",
  });
  if (!business) return null;
  const { role } = await assertManager(privyUserId, business._id);
  return toBusinessOutput(business, role);
}
export async function onboarding(privyUserId: string) {
  const config = verificationConfig();
  const business = await boundBusiness(privyUserId);
  const status = business
    ? await verificationStatus(privyUserId, business.businessId, config)
    : null;
  return {
    business,
    status,
    submitted: !!status?.firstSubmittedAt,
    serviceAvailable: readiness(config).ready,
  };
}
export async function requireAccountSubmission(account: string) {
  try {
    const environment = verificationConfig().environment;
    if (!environment) throw new Error("No environment");
    const business = await (await getBusinessProfiles()).findOne({
      boundAccount: account,
      lifecycle: "active",
    });
    const doc =
      business &&
      (await (
        await getVerificationCases()
      ).findOne({ businessId: business._id, provider: "sumsub", environment }));
    if (
      doc?.firstSubmittedAt instanceof Date &&
      Number.isFinite(doc.firstSubmittedAt.getTime())
    )
      return;
  } catch {
    /* Storage/configuration failures must not unlock payment operations. */
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: SUBMISSION_REQUIRED,
  });
}
export async function requireSubmission(privyUserId: string) {
  const wallet = await currentWallet(privyUserId).catch(() => null);
  if (!wallet)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: SUBMISSION_REQUIRED,
    });
  await requireAccountSubmission(wallet.contractId);
  return wallet;
}
