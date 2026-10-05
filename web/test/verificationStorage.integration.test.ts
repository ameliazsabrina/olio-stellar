// @vitest-environment node
import { randomUUID } from "node:crypto";
import { type Db, MongoClient } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("../src/server/db/mongo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/db/mongo")>();
  return {
    ...actual,
    getDb: async () => mocks.db!,
    getBusinessProfiles: async () => mocks.db!.collection("business_profiles"),
    getBusinessMemberships: async () =>
      mocks.db!.collection("business_memberships"),
    getVerificationCases: async () =>
      mocks.db!.collection("verification_cases"),
    getVerificationEvents: async () =>
      mocks.db!.collection("verification_events"),
    getVerificationAudit: async () =>
      mocks.db!.collection("verification_audit"),
    getIdentityCredentials: async () =>
      mocks.db!.collection("identity_credentials"),
    getVerificationCoordination: async () =>
      mocks.db!.collection("verification_coordination"),
  };
});

import type {
  IdentityCredentialDoc,
  VerificationCaseDoc,
  VerificationEventDoc,
} from "../src/server/db/mongo";
import {
  applyCaseUpdate,
  claimCase,
  claimDueCase,
  claimNextEvent,
  finishEvent,
  refreshWorkerHeartbeat,
  releaseCase,
  requestReconcile,
  sharedBudget,
  storageReady,
  syncCredential,
  workerAlive,
} from "../src/server/modules/verification/verification.storage";

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
let client: MongoClient;

const cases = () =>
  mocks.db!.collection<VerificationCaseDoc>("verification_cases");
const events = () =>
  mocks.db!.collection<VerificationEventDoc>("verification_events");
const credentials = () =>
  mocks.db!.collection<IdentityCredentialDoc>("identity_credentials");

function caseDoc(
  overrides: Partial<VerificationCaseDoc> = {},
): VerificationCaseDoc {
  const now = new Date();
  return {
    _id: randomUUID().slice(0, 12),
    businessId: `biz_${randomUUID().slice(0, 8)}`,
    provider: "sumsub",
    environment: "sandbox",
    externalUserId: `olio-sandbox-${randomUUID().replaceAll("-", "")}`,
    applicantId: `app_${randomUUID().slice(0, 8)}`,
    applicantType: "individual",
    levelName: "olio-individual",
    reviewCycle: 1,
    eligibility: "pending",
    userMessage: null,
    internalReasons: [],
    snapshot: null,
    policyVersion: 1,
    providerCheckedAt: null,
    revision: 1,
    reconcileAt: new Date(now.getTime() - 1000),
    lastEventAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function eventDoc(
  overrides: Partial<VerificationEventDoc> = {},
): VerificationEventDoc {
  const now = new Date();
  return {
    _id: `sumsub:sandbox:${randomUUID().replaceAll("-", "")}`,
    provider: "sumsub",
    environment: "sandbox",
    externalUserId: "olio-sandbox-1",
    applicantId: "app_1",
    type: "applicantReviewed",
    reviewStatus: "completed",
    reviewAnswer: "GREEN",
    providerCreatedAt: null,
    correlationId: null,
    state: "queued",
    attempts: 0,
    nextAttemptAt: new Date(now.getTime() - 1000),
    receivedAt: now,
    ...overrides,
  };
}

suite("verification storage against isolated MongoDB", () => {
  beforeAll(async () => {
    client = await new MongoClient(uri as string, {
      serverSelectionTimeoutMS: 3000,
    }).connect();
    mocks.db = client.db(
      `olio_verification_test_${randomUUID().replaceAll("-", "")}`,
    );
    // @ts-expect-error plain ESM production migration
    const migration = await import(
      "../migrations/20260921090000-business-verification.js"
    );
    await migration.up(mocks.db);
    await migration.up(mocks.db);
    const onboardingMigration = await import(
      "../migrations/20261004090000-verification-onboarding.js"
    );
    await onboardingMigration.up(mocks.db);
  });

  afterAll(async () => {
    if (mocks.db) await mocks.db.dropDatabase();
    await client?.close();
  });

  beforeEach(async () => {
    for (const name of [
      "business_profiles",
      "business_memberships",
      "verification_cases",
      "verification_events",
      "verification_audit",
      "identity_credentials",
      "verification_coordination",
    ]) {
      await mocks.db!.collection(name).deleteMany({});
    }
  });

  it("creates every index the readiness check requires and is idempotent", async () => {
    expect(await storageReady()).toBe(true);
  });

  it("rejects a second case for the same business and environment", async () => {
    const first = caseDoc();
    await cases().insertOne(first);
    await expect(
      cases().insertOne(
        caseDoc({ businessId: first.businessId, environment: "sandbox" }),
      ),
    ).rejects.toMatchObject({ code: 11000 });
    await cases().insertOne(
      caseDoc({ businessId: first.businessId, environment: "live" }),
    );
    expect(await cases().countDocuments({ businessId: first.businessId })).toBe(
      2,
    );
  });

  it("rejects two cases sharing one applicant or external id", async () => {
    const first = caseDoc();
    await cases().insertOne(first);
    await expect(
      cases().insertOne(caseDoc({ externalUserId: first.externalUserId })),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      cases().insertOne(caseDoc({ applicantId: first.applicantId })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows many cases that have no applicant yet", async () => {
    await cases().insertOne(caseDoc({ applicantId: null }));
    await cases().insertOne(caseDoc({ applicantId: null }));
    expect(await cases().countDocuments({ applicantId: null })).toBe(2);
  });

  it("rejects a duplicate webhook event id", async () => {
    const event = eventDoc();
    await events().insertOne(event);
    await expect(events().insertOne(event)).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("gives the case lease to one competing worker at a time", async () => {
    const doc = caseDoc();
    await cases().insertOne(doc);
    const [a, b] = await Promise.all([claimCase(doc._id), claimCase(doc._id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const winner = (a ?? b)!;
    await releaseCase(doc._id, winner.owner);
    expect(await claimCase(doc._id)).not.toBeNull();
  });

  it("lets another worker take over after the lease expires", async () => {
    const doc = caseDoc();
    await cases().insertOne(doc);
    const held = await claimCase(doc._id);
    expect(held).not.toBeNull();
    expect(await claimCase(doc._id)).toBeNull();
    const later = new Date(Date.now() + 10 * 60_000);
    const takeover = await claimCase(doc._id, later);
    expect(takeover?.owner).not.toBe(held?.owner);
  });

  it("refuses a stale-revision update and keeps the newer state", async () => {
    const doc = caseDoc();
    await cases().insertOne(doc);
    const updated = await applyCaseUpdate(doc._id, doc.revision, {
      eligibility: "approved",
    });
    expect(updated.revision).toBe(2);
    await expect(
      applyCaseUpdate(doc._id, doc.revision, { eligibility: "declined" }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect((await cases().findOne({ _id: doc._id }))?.eligibility).toBe(
      "approved",
    );
  });

  it("refuses a lease-scoped update once the lease is gone", async () => {
    const doc = caseDoc();
    await cases().insertOne(doc);
    const claimed = await claimCase(doc._id);
    await releaseCase(doc._id, claimed!.owner);
    await expect(
      applyCaseUpdate(
        doc._id,
        doc.revision,
        { eligibility: "approved" },
        claimed!.owner,
      ),
    ).rejects.toMatchObject({ code: "lease_lost" });
  });

  it("claims only due, applicant-bearing cases in reconcile order", async () => {
    const soon = caseDoc({ reconcileAt: new Date(Date.now() - 5_000) });
    const later = caseDoc({ reconcileAt: new Date(Date.now() + 3_600_000) });
    const unstarted = caseDoc({
      applicantId: null,
      reconcileAt: new Date(Date.now() - 10_000),
    });
    await cases().insertMany([later, soon, unstarted]);
    const claimed = await claimDueCase();
    expect(claimed?.doc._id).toBe(soon._id);
    await releaseCase(soon._id, claimed!.owner);
    await cases().updateOne(
      { _id: soon._id },
      { $set: { reconcileAt: new Date(Date.now() + 3_600_000) } },
    );
    expect(await claimDueCase()).toBeNull();
  });

  it("brings a case forward when an operator requests reconciliation", async () => {
    const doc = caseDoc({ reconcileAt: new Date(Date.now() + 3_600_000) });
    await cases().insertOne(doc);
    expect(await claimDueCase()).toBeNull();
    expect(await requestReconcile({ _id: doc._id })).toBe(1);
    expect((await claimDueCase())?.doc._id).toBe(doc._id);
  });

  it("claims one event at a time and counts the attempt", async () => {
    const event = eventDoc();
    await events().insertOne(event);
    const [a, b] = await Promise.all([claimNextEvent(), claimNextEvent()]);
    const claimed = (a ?? b)!;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(claimed.doc.attempts).toBe(1);
    await finishEvent(event._id, claimed.owner, {
      state: "done",
      caseId: "case_1",
    });
    const stored = await events().findOne({ _id: event._id });
    expect(stored).toMatchObject({ state: "done", caseId: "case_1" });
    expect(stored?.leaseOwner).toBeUndefined();
    expect(await claimNextEvent()).toBeNull();
  });

  it("reschedules a retried event and parks a failed one", async () => {
    const retry = eventDoc();
    const parked = eventDoc();
    await events().insertMany([retry, parked]);
    const first = (await claimNextEvent())!;
    await finishEvent(first.doc._id, first.owner, {
      state: "queued",
      nextAttemptAt: new Date(Date.now() + 3_600_000),
      error: "provider_timeout",
    });
    const second = (await claimNextEvent())!;
    await finishEvent(second.doc._id, second.owner, {
      state: "parked",
      error: "unknown_case",
    });
    expect(await claimNextEvent()).toBeNull();
    expect(await events().countDocuments({ state: "parked" })).toBe(1);
    expect(await events().countDocuments({ state: "queued" })).toBe(1);
  });

  it("issues one credential per business and environment even under a race", async () => {
    const doc = caseDoc({
      eligibility: "approved",
      providerCheckedAt: new Date(),
    });
    await cases().insertOne(doc);
    const results = await Promise.all([
      syncCredential(doc),
      syncCredential(doc),
    ]);
    expect(
      await credentials().countDocuments({ businessId: doc.businessId }),
    ).toBe(1);
    expect(results.some((result) => result.action === "issued")).toBe(true);
  });

  it("suspends and unpublishes the credential when eligibility regresses", async () => {
    const approved = caseDoc({
      eligibility: "approved",
      providerCheckedAt: new Date(),
    });
    await cases().insertOne(approved);
    await syncCredential(approved);
    await credentials().updateOne(
      { businessId: approved.businessId },
      { $set: { published: true, publishedAt: new Date() } },
    );
    const regressed = {
      ...approved,
      eligibility: "declined" as const,
      revision: 2,
    };
    const result = await syncCredential(regressed);
    expect(result.action).toBe("suspended");
    const stored = await credentials().findOne({
      businessId: approved.businessId,
    });
    expect(stored).toMatchObject({
      status: "suspended",
      published: false,
      suspensionReason: "eligibility_declined",
    });
  });

  it("does not re-suspend an already suspended credential", async () => {
    const approved = caseDoc({
      eligibility: "approved",
      providerCheckedAt: new Date(),
    });
    await cases().insertOne(approved);
    await syncCredential(approved);
    const regressed = {
      ...approved,
      eligibility: "manual_review" as const,
      revision: 2,
    };
    expect((await syncCredential(regressed)).action).toBe("suspended");
    expect((await syncCredential(regressed)).action).toBe("none");
  });

  it("reactivates a suspended credential only through a newer approved revision", async () => {
    const approved = caseDoc({
      eligibility: "approved",
      providerCheckedAt: new Date(),
    });
    await cases().insertOne(approved);
    await syncCredential(approved);
    await syncCredential({ ...approved, eligibility: "declined", revision: 2 });
    const reapproved = {
      ...approved,
      revision: 3,
      providerCheckedAt: new Date(),
    };
    expect((await syncCredential(reapproved)).action).toBe("issued");
    expect(
      (await credentials().findOne({ businessId: approved.businessId }))
        ?.status,
    ).toBe("active");
  });

  it("keeps the credential untouched when an approved case is re-synced at the same revision", async () => {
    const approved = caseDoc({
      eligibility: "approved",
      providerCheckedAt: new Date(),
    });
    await cases().insertOne(approved);
    await syncCredential(approved);
    expect((await syncCredential(approved)).action).toBe("none");
  });

  it("enforces a shared budget across processes and expires it", async () => {
    await sharedBudget("test-key", 2, 60_000);
    await sharedBudget("test-key", 2, 60_000);
    await expect(sharedBudget("test-key", 2, 60_000)).rejects.toMatchObject({
      code: "throttled",
    });
  });

  it("reports worker liveness only while the heartbeat is current", async () => {
    expect(await workerAlive()).toBeNull();
    await refreshWorkerHeartbeat();
    expect(await workerAlive()).not.toBeNull();
    expect(await workerAlive(new Date(Date.now() + 10 * 60_000))).toBeNull();
  });
});
