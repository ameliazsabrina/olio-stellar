import "server-only";
import { randomBytes } from "node:crypto";
import {
  type BusinessProfileDoc,
  getIdentityCredentials,
  getVerificationCases,
  type IdentityCredentialDoc,
  type VerificationCaseDoc,
  type VerificationEnvironment,
} from "../../db/mongo";
import {
  assertManager,
  assertMember,
  recordAudit,
} from "../businesses/businesses.service";
import { configuredSumsubClient, type SumsubClient } from "./sumsub.client";
import {
  assertReady,
  levelFor,
  readiness,
  SDK_TOKEN_TTL_SECONDS,
  type VerificationConfig,
  verificationConfig,
} from "./verification.config";
import {
  VerificationDisabledError,
  VerificationStateError,
} from "./verification.errors";
import {
  credentialIsCurrent,
  evaluatePolicy,
  nextReconcileAt,
  USER_MESSAGES,
} from "./verification.policy";
import type {
  CredentialSummary,
  NextAction,
  OperatorCaseSummary,
  ProviderStage,
  RefreshOutput,
  SdkTokenOutput,
  VerificationStatusOutput,
} from "./verification.schema";
import {
  applyCaseUpdate,
  claimCase,
  releaseCase,
  sharedBudget,
  syncCredential,
} from "./verification.storage";

export const RECONCILE_RETRY_MS = 60_000;

export type ReconcileDeps = {
  client?: SumsubClient;
  config?: VerificationConfig;
  now?: () => Date;
  submissionReceivedAt?: Date;
};

export function newExternalUserId(environment: VerificationEnvironment) {
  return `olio-${environment}-${randomBytes(16).toString("hex")}`;
}

export function providerStage(doc: VerificationCaseDoc | null): ProviderStage {
  if (!doc?.applicantId) return "not_started";
  switch (doc.snapshot?.reviewStatus ?? null) {
    case null:
    case "init":
    case "awaitingUser":
      return "in_progress";
    case "pending":
    case "prechecked":
    case "queued":
    case "awaitingService":
      return "submitted";
    case "onHold":
      return "on_hold";
    case "completed":
      return "completed";
  }
}

export function nextActionFor(
  doc: VerificationCaseDoc | null,
  ready: boolean,
): NextAction {
  if (!ready) return "wait";
  if (!doc?.applicantId) return "start";
  switch (doc.eligibility) {
    case "not_started":
      return "continue";
    case "pending":
    case "manual_review":
      return "wait";
    case "needs_information":
      return "resubmit";
    case "approved":
      return "done";
    case "declined":
      return "contact_support";
  }
}

export function credentialSummary(
  credential: IdentityCredentialDoc | null,
  now: Date,
): CredentialSummary | null {
  if (!credential) return null;
  const expired =
    credential.status === "active" && !credentialIsCurrent(credential, now);
  return {
    status: expired ? "expired" : credential.status,
    issuer: credential.issuer,
    policyVersion: credential.policyVersion,
    checkedAt: credential.checkedAt.toISOString(),
    validUntil: credential.validUntil.toISOString(),
    published: credential.published && !expired,
    environment: credential.environment,
  };
}

async function currentCase(
  businessId: string,
  environment: VerificationEnvironment | null,
): Promise<VerificationCaseDoc | null> {
  if (!environment) return null;
  return (await getVerificationCases()).findOne({
    businessId,
    provider: "sumsub",
    environment,
  });
}

async function currentCredential(
  businessId: string,
  environment: VerificationEnvironment | null,
): Promise<IdentityCredentialDoc | null> {
  if (!environment) return null;
  return (await getIdentityCredentials()).findOne({ businessId, environment });
}

export function buildStatus(
  business: BusinessProfileDoc,
  doc: VerificationCaseDoc | null,
  credential: IdentityCredentialDoc | null,
  config: VerificationConfig,
  now = new Date(),
): VerificationStatusOutput {
  const ready = readiness(config).ready;
  const eligibility = doc?.eligibility ?? "not_started";
  return {
    firstSubmittedAt: doc?.firstSubmittedAt?.toISOString() ?? null,
    businessId: business._id,
    type: business.type,
    environment: config.environment,
    mode: config.mode,
    eligibility,
    providerStage: providerStage(doc),
    userMessage: ready
      ? (doc?.userMessage ?? null)
      : "Identity verification is not available on this deployment yet.",
    nextAction: nextActionFor(doc, ready),
    checkedAt: doc?.providerCheckedAt?.toISOString() ?? null,
    lastEventAt: doc?.lastEventAt?.toISOString() ?? null,
    policyVersion: doc?.policyVersion ?? config.policyVersion,
    credential: credentialSummary(credential, now),
    canStart:
      ready &&
      business.lifecycle === "active" &&
      business.boundAccount !== null &&
      eligibility !== "approved",
  };
}

export async function verificationStatus(
  privyUserId: string,
  businessId: string,
  config = verificationConfig(),
): Promise<VerificationStatusOutput> {
  const { business } = await assertMember(privyUserId, businessId);
  const doc = await currentCase(businessId, config.environment);
  const credential = await currentCredential(businessId, config.environment);
  return buildStatus(business, doc, credential, config);
}

async function ensureCase(
  business: BusinessProfileDoc,
  environment: VerificationEnvironment,
  config: VerificationConfig,
  now: Date,
): Promise<VerificationCaseDoc> {
  const cases = await getVerificationCases();
  const existing = await currentCase(business._id, environment);
  if (existing) return existing;
  const doc: VerificationCaseDoc = {
    _id: randomBytes(12).toString("base64url"),
    firstSubmittedAt: null,
    businessId: business._id,
    provider: "sumsub",
    environment,
    externalUserId: newExternalUserId(environment),
    applicantId: null,
    applicantType: business.type,
    levelName: levelFor(business.type, config),
    reviewCycle: 1,
    eligibility: "not_started",
    userMessage: null,
    internalReasons: [],
    snapshot: null,
    policyVersion: config.policyVersion,
    providerCheckedAt: null,
    revision: 1,
    reconcileAt: new Date(now.getTime() + 60 * 60_000),
    lastEventAt: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await cases.insertOne(doc);
    return doc;
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await currentCase(business._id, environment);
    if (!raced) throw error;
    return raced;
  }
}

export async function startVerification(
  privyUserId: string,
  businessId: string,
  deps: ReconcileDeps = {},
): Promise<VerificationStatusOutput> {
  const config = deps.config ?? verificationConfig();
  if (config.mode === "off") throw new VerificationDisabledError();
  const { environment } = assertReady(config);
  const { business } = await assertManager(privyUserId, businessId);
  if (business.lifecycle !== "active") {
    throw new VerificationStateError("closed");
  }
  if (!business.boundAccount) throw new VerificationStateError("not_bound");
  await sharedBudget(`start:${businessId}`, 5, 60_000);
  const now = deps.now?.() ?? new Date();
  let doc = await ensureCase(business, environment, config, now);
  if (!doc.applicantId) {
    const client = deps.client ?? configuredSumsubClient(config);
    const applicant = await client.ensureApplicant({
      externalUserId: doc.externalUserId,
      type: doc.applicantType,
      levelName: doc.levelName,
    });
    doc = await applyCaseUpdate(doc._id, doc.revision, {
      applicantId: applicant.applicantId,
      reconcileAt: new Date(now.getTime() + 15 * 60_000),
    });
    await recordAudit({
      actor: privyUserId,
      action: "verification.started",
      businessId,
      caseId: doc._id,
      fromRevision: doc.revision - 1,
      toRevision: doc.revision,
      reasonCode: applicant.created ? "applicant_created" : "applicant_resumed",
    });
  }
  const credential = await currentCredential(businessId, environment);
  return buildStatus(business, doc, credential, config, now);
}

export async function issueSdkToken(
  privyUserId: string,
  businessId: string,
  deps: ReconcileDeps = {},
): Promise<SdkTokenOutput> {
  const config = deps.config ?? verificationConfig();
  if (config.mode === "off") throw new VerificationDisabledError();
  const { environment } = assertReady(config);
  const { business } = await assertManager(privyUserId, businessId);
  if (business.lifecycle !== "active") {
    throw new VerificationStateError("closed");
  }
  const doc = await currentCase(businessId, environment);
  if (!doc?.applicantId) throw new VerificationStateError("no_case");
  await sharedBudget(`token:${businessId}`, 20, 60_000);
  const client = deps.client ?? configuredSumsubClient(config);
  const token = await client.createSdkToken({
    externalUserId: doc.externalUserId,
    levelName: doc.levelName,
    ttlInSecs: SDK_TOKEN_TTL_SECONDS,
  });
  return { token: token.token, expiresInSeconds: token.ttlInSecs };
}

export type ReconcileResult = {
  doc: VerificationCaseDoc;
  changed: boolean;
  credential: Awaited<ReturnType<typeof syncCredential>>["action"];
};

export async function reconcileCase(
  caseId: string,
  actor: string,
  deps: ReconcileDeps = {},
  lease?: { doc: VerificationCaseDoc; owner: string },
): Promise<ReconcileResult> {
  const config = deps.config ?? verificationConfig();
  const now = deps.now?.() ?? new Date();
  const claimed = lease ?? (await claimCase(caseId, now));
  if (!claimed) throw new VerificationStateError("lease_lost");
  const { doc, owner } = claimed;
  try {
    if (!doc.applicantId) {
      return { doc, changed: false, credential: "none" };
    }
    if (doc.environment !== config.environment) {
      throw new VerificationStateError("environment_mismatch");
    }
    const client = deps.client ?? configuredSumsubClient(config);
    let snapshot: Awaited<ReturnType<SumsubClient["snapshot"]>>;
    try {
      snapshot = await client.snapshot(doc.applicantId);
    } catch (error) {
      await (await getVerificationCases()).updateOne(
        { _id: caseId, leaseOwner: owner },
        { $set: { reconcileAt: new Date(now.getTime() + RECONCILE_RETRY_MS) } },
      );
      throw error;
    }
    const decision = evaluatePolicy({
      snapshot,
      expectedType: doc.applicantType,
      expectedLevel: doc.levelName,
      environment: doc.environment,
      policyVersion: config.policyVersion,
    });
    const previousStatus = doc.snapshot?.reviewStatus ?? null;
    const reset =
      snapshot.reviewStatus === "init" &&
      previousStatus !== null &&
      previousStatus !== "init";
    const eligibility = reset ? "needs_information" : decision.eligibility;
    const updated = await applyCaseUpdate(
      caseId,
      doc.revision,
      {
        eligibility,
        userMessage: reset
          ? USER_MESSAGES.needs_information
          : decision.userMessage,
        internalReasons: reset ? ["provider_reset"] : decision.internalReasons,
        snapshot,
        policyVersion: config.policyVersion,
        providerCheckedAt: snapshot.checkedAt,
        reconcileAt: nextReconcileAt(eligibility, now),
        reviewCycle: reset ? doc.reviewCycle + 1 : doc.reviewCycle,
      },
      owner,
      now,
      deps.submissionReceivedAt,
    );
    const changed = updated.eligibility !== doc.eligibility;
    if (changed) {
      await recordAudit({
        actor,
        action: "verification.eligibility_changed",
        businessId: doc.businessId,
        caseId,
        fromRevision: doc.revision,
        toRevision: updated.revision,
        reasonCode: `${doc.eligibility}->${updated.eligibility}`,
      });
    }
    const credential = await syncCredential(updated, now);
    if (credential.action !== "none") {
      await recordAudit({
        actor,
        action: `credential.${credential.action}`,
        businessId: doc.businessId,
        caseId,
        fromRevision: doc.revision,
        toRevision: updated.revision,
        reasonCode: credential.credential.suspensionReason ?? "policy",
      });
    }
    return { doc: updated, changed, credential: credential.action };
  } finally {
    await releaseCase(caseId, owner);
  }
}

export async function refreshVerification(
  privyUserId: string,
  businessId: string,
  deps: ReconcileDeps = {},
): Promise<RefreshOutput> {
  const config = deps.config ?? verificationConfig();
  const { business } = await assertMember(privyUserId, businessId);
  await sharedBudget(`refresh:${businessId}`, 6, 60_000);
  const doc = await currentCase(businessId, config.environment);
  let reconciled = false;
  if (doc?.applicantId && readiness(config).ready) {
    try {
      await reconcileCase(doc._id, privyUserId, { ...deps, config });
      reconciled = true;
    } catch {
      reconciled = false;
    }
  }
  const latest = await currentCase(businessId, config.environment);
  const credential = await currentCredential(businessId, config.environment);
  return {
    status: buildStatus(business, latest, credential, config),
    reconciled,
  };
}

export function isOperator(
  privyUserId: string,
  config = verificationConfig(),
): boolean {
  return config.operatorIds.includes(privyUserId);
}

export function operatorSummary(doc: VerificationCaseDoc): OperatorCaseSummary {
  return {
    caseId: doc._id,
    firstSubmittedAt: doc.firstSubmittedAt?.toISOString() ?? null,
    businessId: doc.businessId,
    environment: doc.environment,
    applicantType: doc.applicantType,
    eligibility: doc.eligibility,
    reviewStatus: doc.snapshot?.reviewStatus ?? null,
    reviewAnswer: doc.snapshot?.reviewAnswer ?? null,
    internalReasons: doc.internalReasons,
    revision: doc.revision,
    providerCheckedAt: doc.providerCheckedAt?.toISOString() ?? null,
    reconcileAt: doc.reconcileAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listCasesForOperator(
  privyUserId: string,
  input: { eligibility?: VerificationCaseDoc["eligibility"]; limit: number },
  config = verificationConfig(),
): Promise<OperatorCaseSummary[]> {
  if (!isOperator(privyUserId, config)) {
    throw new VerificationStateError("forbidden");
  }
  const filter: Record<string, unknown> = { provider: "sumsub" };
  if (config.environment) filter.environment = config.environment;
  if (input.eligibility) filter.eligibility = input.eligibility;
  const docs = await (await getVerificationCases())
    .find(filter)
    .sort({ updatedAt: -1 })
    .limit(input.limit)
    .toArray();
  return docs.map(operatorSummary);
}
