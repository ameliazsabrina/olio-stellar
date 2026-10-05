import "server-only";
import { submissionEvidence } from "./verification.evidence";
import { createHash, randomUUID } from "node:crypto";
import {
  type EligibilityState,
  getDb,
  getIdentityCredentials,
  getVerificationCases,
  getVerificationCoordination,
  getVerificationEvents,
  type IdentityCredentialDoc,
  type VerificationCaseDoc,
  type VerificationEventDoc,
} from "../../db/mongo";
import { VerificationStateError } from "./verification.errors";
import { credentialValidUntil } from "./verification.policy";

export const CASE_LEASE_MS = 5 * 60_000;
export const EVENT_LEASE_MS = 5 * 60_000;
export const WORKER_HEARTBEAT_MS = 120_000;
export const WORKER_HEARTBEAT_KEY = "worker:verification";
export const MAX_EVENT_ATTEMPTS = 8;

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function sharedBudget(
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const bucket = Math.floor(Date.now() / windowMs);
  const row = await (await getVerificationCoordination()).findOneAndUpdate(
    { _id: `budget:${key}:${bucket}` },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!row || (row.count ?? 0) > limit) {
    throw new VerificationStateError("throttled", windowMs);
  }
}

export async function refreshWorkerHeartbeat(now = new Date()): Promise<void> {
  await (await getVerificationCoordination()).updateOne(
    { _id: WORKER_HEARTBEAT_KEY },
    { $set: { until: new Date(now.getTime() + WORKER_HEARTBEAT_MS) } },
    { upsert: true },
  );
}

export async function workerAlive(now = new Date()): Promise<Date | null> {
  const row = await (await getVerificationCoordination()).findOne({
    _id: WORKER_HEARTBEAT_KEY,
  });
  return row?.until && row.until.getTime() > now.getTime() ? row.until : null;
}

export async function claimCase(
  caseId: string,
  now = new Date(),
): Promise<{ doc: VerificationCaseDoc; owner: string } | null> {
  const owner = randomUUID();
  const doc = await (await getVerificationCases()).findOneAndUpdate(
    {
      _id: caseId,
      $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
    },
    {
      $set: {
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + CASE_LEASE_MS),
      },
    },
    { returnDocument: "after", writeConcern: { w: "majority", j: true } },
  );
  return doc ? { doc, owner } : null;
}

export async function claimDueCase(
  now = new Date(),
): Promise<{ doc: VerificationCaseDoc; owner: string } | null> {
  const owner = randomUUID();
  const doc = await (await getVerificationCases()).findOneAndUpdate(
    {
      reconcileAt: { $lte: now },
      applicantId: { $type: "string" },
      $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
    },
    {
      $set: {
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + CASE_LEASE_MS),
      },
    },
    {
      sort: { reconcileAt: 1 },
      returnDocument: "after",
      writeConcern: { w: "majority", j: true },
    },
  );
  return doc ? { doc, owner } : null;
}

export async function releaseCase(caseId: string, owner: string) {
  await (await getVerificationCases()).updateOne(
    { _id: caseId, leaseOwner: owner },
    { $unset: { leaseOwner: "", leaseUntil: "" } },
  );
}

export type CaseUpdate = Partial<
  Pick<
    VerificationCaseDoc,
    | "applicantId"
    | "eligibility"
    | "userMessage"
    | "internalReasons"
    | "snapshot"
    | "policyVersion"
    | "providerCheckedAt"
    | "reconcileAt"
    | "lastEventAt"
    | "reviewCycle"
    | "levelName"
  >
>;

export async function applyCaseUpdate(
  caseId: string,
  expectedRevision: number,
  update: CaseUpdate,
  owner?: string,
  now = new Date(),
  submissionReceivedAt?: Date,
): Promise<VerificationCaseDoc> {
  const filter: Record<string, unknown> = {
    _id: caseId,
    revision: expectedRevision,
  };
  if (owner) {
    filter.leaseOwner = owner;
    filter.leaseUntil = { $gt: now };
  }
  const previous = await (await getVerificationCases()).findOne({
    _id: caseId,
    revision: expectedRevision,
  });
  if (!previous) throw new VerificationStateError("revision_conflict");
  const firstSubmission =
    !previous.firstSubmittedAt &&
    (!!submissionReceivedAt ||
      (submissionEvidence(update.snapshot, previous.environment) &&
        update.snapshot?.applicantType === previous.applicantType &&
        (!update.snapshot.levelName ||
          update.snapshot.levelName === previous.levelName)));
  const deliveries = [];
  if (firstSubmission)
    deliveries.push({
      id: `${caseId}:${expectedRevision + 1}:submitted`,
      kind: "submitted" as const,
      at: now,
    });
  if (update.eligibility && update.eligibility !== previous.eligibility)
    deliveries.push({
      id: `${caseId}:${expectedRevision + 1}:${update.eligibility}`,
      kind: update.eligibility,
      at: now,
    });
  const updated = await (await getVerificationCases()).findOneAndUpdate(
    filter,
    {
      $set: {
        ...update,
        ...(firstSubmission
          ? { firstSubmittedAt: submissionReceivedAt ?? now }
          : {}),
        updatedAt: now,
      },
      $inc: { revision: 1 },
      ...(deliveries.length
        ? { $push: { notificationOutbox: { $each: deliveries } } }
        : {}),
    },
    { returnDocument: "after", writeConcern: { w: "majority", j: true } },
  );
  if (!updated) {
    const current = await (await getVerificationCases()).findOne({
      _id: caseId,
    });
    throw new VerificationStateError(
      current && current.revision !== expectedRevision
        ? "revision_conflict"
        : "lease_lost",
    );
  }
  return updated;
}

export async function requestReconcile(
  filter: Partial<Pick<VerificationCaseDoc, "_id" | "businessId">>,
  now = new Date(),
): Promise<number> {
  const result = await (await getVerificationCases()).updateMany(filter, {
    $set: { reconcileAt: now, updatedAt: now },
  });
  return result.matchedCount;
}

export async function claimNextEvent(
  now = new Date(),
): Promise<{ doc: VerificationEventDoc; owner: string } | null> {
  const owner = randomUUID();
  const doc = await (await getVerificationEvents()).findOneAndUpdate(
    {
      state: "queued",
      nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
    },
    {
      $set: {
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + EVENT_LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { nextAttemptAt: 1 },
      returnDocument: "after",
      writeConcern: { w: "majority", j: true },
    },
  );
  return doc ? { doc, owner } : null;
}

export async function finishEvent(
  eventId: string,
  owner: string,
  outcome:
    | { state: "done"; caseId: string | null }
    | { state: "queued"; nextAttemptAt: Date; error: string }
    | { state: "parked"; error: string },
  now = new Date(),
): Promise<void> {
  const set: Record<string, unknown> = { state: outcome.state };
  if (outcome.state === "done") {
    set.processedAt = now;
    if (outcome.caseId) set.caseId = outcome.caseId;
  } else {
    set.lastError = outcome.error;
    if (outcome.state === "queued") set.nextAttemptAt = outcome.nextAttemptAt;
  }
  await (await getVerificationEvents()).updateOne(
    { _id: eventId, leaseOwner: owner },
    { $set: set, $unset: { leaseOwner: "", leaseUntil: "" } },
  );
}

export type CredentialSync =
  | { action: "none" }
  | { action: "issued"; credential: IdentityCredentialDoc }
  | { action: "renewed"; credential: IdentityCredentialDoc }
  | { action: "suspended"; credential: IdentityCredentialDoc };

export async function syncCredential(
  doc: VerificationCaseDoc,
  now = new Date(),
): Promise<CredentialSync> {
  const credentials = await getIdentityCredentials();
  const filter = { businessId: doc.businessId, environment: doc.environment };
  const existing = await credentials.findOne(filter);
  const checkedAt = doc.providerCheckedAt ?? now;

  if (doc.eligibility === "approved") {
    if (!existing) {
      const credential: IdentityCredentialDoc = {
        _id: randomUUID().replaceAll("-", ""),
        businessId: doc.businessId,
        environment: doc.environment,
        caseId: doc._id,
        caseRevision: doc.revision,
        issuer: "olio",
        policyVersion: doc.policyVersion,
        checkedAt,
        validUntil: credentialValidUntil(checkedAt),
        status: "active",
        suspensionReason: null,
        published: false,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await credentials.insertOne(credential);
        return { action: "issued", credential };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        return syncCredential(doc, now);
      }
    }
    if (existing.caseRevision >= doc.revision && existing.status === "active") {
      return { action: "none" };
    }
    const renewed = await credentials.findOneAndUpdate(
      { _id: existing._id, updatedAt: existing.updatedAt },
      {
        $set: {
          caseId: doc._id,
          caseRevision: doc.revision,
          policyVersion: doc.policyVersion,
          checkedAt,
          validUntil: credentialValidUntil(checkedAt),
          status: "active",
          suspensionReason: null,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!renewed) throw new VerificationStateError("revision_conflict");
    return {
      action: existing.status === "active" ? "renewed" : "issued",
      credential: renewed,
    };
  }

  if (existing?.status !== "active") return { action: "none" };
  const suspended = await credentials.findOneAndUpdate(
    { _id: existing._id, status: "active" },
    {
      $set: {
        status: "suspended",
        suspensionReason: `eligibility_${doc.eligibility}`,
        published: false,
        caseRevision: doc.revision,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!suspended) return { action: "none" };
  return { action: "suspended", credential: suspended };
}

export const REQUIRED_INDEXES: Record<string, string[]> = {
  business_profiles: [
    "business_public_id",
    "business_username",
    "business_bound_account",
  ],
  notifications: ["notification_inbox", "notification_unread"],
  business_memberships: ["membership_business_user"],
  verification_cases: [
    "case_external_user",
    "case_applicant",
    "case_business_environment",
    "case_reconcile_due",
    "case_notification_delivery",
  ],
  verification_events: ["event_due"],
  identity_credentials: ["credential_business_environment"],
};

export async function storageReady(): Promise<boolean> {
  const db = await getDb();
  for (const [collection, required] of Object.entries(REQUIRED_INDEXES)) {
    let names: Set<string | undefined>;
    try {
      names = new Set(
        (await db.collection(collection).listIndexes().toArray()).map(
          (index) => index.name,
        ),
      );
    } catch {
      return false;
    }
    if (!required.every((name) => names.has(name))) return false;
  }
  return true;
}

export function eligibilityIsOpen(eligibility: EligibilityState): boolean {
  return (
    eligibility === "pending" ||
    eligibility === "needs_information" ||
    eligibility === "manual_review" ||
    eligibility === "not_started"
  );
}
