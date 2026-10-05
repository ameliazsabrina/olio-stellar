// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const mocks = vi.hoisted(() => ({
  db: null as Db | null,
  wallet: vi.fn(),
  environment: "sandbox",
  failAck: false,
}));
vi.mock("../src/server/db/mongo", async (original) => ({
  ...(await original<typeof import("../src/server/db/mongo")>()),
  getDb: async () => mocks.db!,
  getBusinessProfiles: async () => mocks.db!.collection("business_profiles"),
  getBusinessMemberships: async () =>
    mocks.db!.collection("business_memberships"),
  getIdentityCredentials: async () =>
    mocks.db!.collection("identity_credentials"),
  getVerificationCases: async () => {
    const cases = mocks.db!.collection("verification_cases");
    if (!mocks.failAck) return cases;
    return {
      find: cases.find.bind(cases),
      updateOne: async () => {
        throw new Error("worker crashed before ack");
      },
    };
  },
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: mocks.wallet,
}));
vi.mock("../src/server/modules/verification/verification.config", () => ({
  verificationConfig: () => ({
    environment: mocks.environment,
    mode: mocks.environment,
    levels: { individual: "individual", company: "company" },
  }),
  readiness: () => ({ ready: true }),
}));
import { applyCaseUpdate } from "../src/server/modules/verification/verification.storage";
import {
  requireSubmission,
  requireAccountSubmission,
  boundBusiness,
} from "../src/server/modules/verification/verification.submission";
import {
  deliverNotifications,
  listNotifications,
  markRead,
} from "../src/server/modules/notifications/notifications.service";
import { submissionEvidence } from "../src/server/modules/verification/verification.evidence";
const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
const now = new Date("2026-10-04T00:00:00Z");
const snapshot = {
  sandboxMode: true,
  applicantType: "individual",
  levelName: "individual",
  reviewStatus: "pending",
  checkedAt: now,
} as any;
let client: MongoClient;
suite("verification onboarding with durable Mongo storage", () => {
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    mocks.db = client.db(`onboarding_${randomUUID().replaceAll("-", "")}`);
  });
  afterAll(async () => {
    await mocks.db!.dropDatabase();
    await client.close();
  });
  beforeEach(async () => {
    mocks.failAck = false;
    mocks.environment = "sandbox";
    mocks.wallet.mockResolvedValue({ contractId: "account-a" });
    for (const name of [
      "business_profiles",
      "business_memberships",
      "verification_cases",
      "verification_events",
      "notifications",
    ])
      await mocks.db!.collection(name).deleteMany({});
    await mocks.db!.collection("business_profiles").insertMany([
      {
        _id: "wrong-business" as any,
        boundAccount: "other-account",
        lifecycle: "active",
        type: "company",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: "business-a" as any,
        boundAccount: "account-a",
        lifecycle: "active",
        type: "individual",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await mocks.db!.collection("business_memberships").insertMany([
      { privyUserId: "user-a", businessId: "wrong-business", role: "owner" },
      { privyUserId: "user-a", businessId: "business-a", role: "owner" },
    ]);
    await mocks.db!.collection("verification_cases").insertOne({
      _id: "case-a" as any,
      businessId: "business-a",
      provider: "sumsub",
      environment: "sandbox",
      applicantType: "individual",
      levelName: "individual",
      revision: 1,
      eligibility: "not_started",
      firstSubmittedAt: null,
      snapshot: null,
    });
  });
  it("migrates reliable provider history and seeds exactly one current-status notification", async () => {
    const cases = mocks.db!.collection("verification_cases");
    await cases.updateOne(
      { _id: "case-a" as any },
      {
        $set: {
          applicantId: "app-a",
          updatedAt: now,
          snapshot: { ...snapshot, reviewStatus: "init" },
          eligibility: "needs_information",
        },
      },
    );
    await mocks.db!.collection("verification_events").insertOne({
      provider: "sumsub",
      environment: "sandbox",
      applicantId: "app-a",
      type: "applicantPending",
      state: "done",
      receivedAt: now,
    });
    const migration = await import(
      "../migrations/20261004090000-verification-onboarding.js"
    );
    await migration.up(mocks.db);
    await migration.up(mocks.db);
    expect(
      (await cases.findOne({ _id: "case-a" as any }))?.firstSubmittedAt,
    ).toEqual(now);
    await deliverNotifications();
    expect((await listNotifications("user-a")).items).toHaveLength(1);
  });
  it("resolves the authenticated wallet instead of first membership and fails closed", async () => {
    expect((await boundBusiness("user-a"))?.businessId).toBe("business-a");
    await expect(requireSubmission("user-a")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "This Olio account must submit verification before making or receiving payments.",
    });
    mocks.wallet.mockResolvedValue(null);
    await expect(requireSubmission("user-a")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("atomically records submission and notifications, retaining access through reset and decline", async () => {
    const first = await applyCaseUpdate(
      "case-a",
      1,
      { snapshot, eligibility: "pending" },
      undefined,
      now,
    );
    expect(first.firstSubmittedAt).toEqual(now);
    expect(first.notificationOutbox?.map((x) => x.kind)).toEqual([
      "submitted",
      "pending",
    ]);
    await expect(requireSubmission("user-a")).resolves.toMatchObject({
      contractId: "account-a",
    });
    await applyCaseUpdate("case-a", 2, {
      snapshot: { ...snapshot, reviewStatus: "init" },
      eligibility: "needs_information",
    });
    await applyCaseUpdate("case-a", 3, { eligibility: "declined" });
    await expect(requireSubmission("user-a")).resolves.toBeDefined();
    mocks.environment = "live";
    await expect(requireAccountSubmission("account-a")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("does not unlock from local eligibility or mismatched provider environment", async () => {
    await applyCaseUpdate("case-a", 1, {
      eligibility: "approved",
      snapshot: { ...snapshot, sandboxMode: false },
    });
    await expect(requireSubmission("user-a")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      submissionEvidence({ ...snapshot, sandboxMode: null }, "sandbox"),
    ).toBe(false);
  });
  it("survives delivery interruption, retries without duplicates and rechecks membership", async () => {
    await applyCaseUpdate(
      "case-a",
      1,
      { snapshot, eligibility: "pending" },
      undefined,
      now,
    );
    mocks.failAck = true;
    await expect(deliverNotifications()).rejects.toThrow("worker crashed");
    mocks.failAck = false;
    await deliverNotifications();
    await deliverNotifications();
    const inbox = await listNotifications("user-a", undefined, 1);
    expect(inbox.unreadCount).toBe(2);
    expect(inbox.nextCursor).toBeTruthy();
    const second = await listNotifications("user-a", inbox.nextCursor!, 1);
    expect(second.items[0].id).not.toBe(inbox.items[0].id);
    await markRead("user-a", inbox.items[0].id);
    expect((await listNotifications("user-a")).unreadCount).toBe(1);
    await markRead("user-a");
    expect((await listNotifications("user-a")).unreadCount).toBe(0);
    await mocks
      .db!.collection("business_memberships")
      .deleteMany({ privyUserId: "user-a" });
    expect((await listNotifications("user-a")).items).toEqual([]);
    await expect(markRead("user-a", inbox.items[0].id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("rejects stale concurrent case writes without enqueuing duplicate transitions", async () => {
    const results = await Promise.allSettled([
      applyCaseUpdate("case-a", 1, { snapshot, eligibility: "pending" }),
      applyCaseUpdate("case-a", 1, { snapshot, eligibility: "pending" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await deliverNotifications();
    expect((await listNotifications("user-a")).items).toHaveLength(2);
  });
});
