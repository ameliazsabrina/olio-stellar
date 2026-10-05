// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderSnapshot,
  VerificationCaseDoc,
} from "../src/server/db/mongo";

const mocks = vi.hoisted(() => ({
  claimCase: vi.fn(),
  releaseCase: vi.fn(),
  applyCaseUpdate: vi.fn(),
  syncCredential: vi.fn(),
  recordAudit: vi.fn(),
  snapshot: vi.fn(),
  updateOne: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../src/server/db/mongo", () => ({
  getVerificationCases: async () => ({
    findOne: mocks.findOne,
    updateOne: mocks.updateOne,
  }),
  getIdentityCredentials: async () => ({ findOne: mocks.findOne }),
}));
vi.mock("../src/server/modules/verification/verification.storage", () => ({
  claimCase: mocks.claimCase,
  releaseCase: mocks.releaseCase,
  applyCaseUpdate: mocks.applyCaseUpdate,
  syncCredential: mocks.syncCredential,
  sharedBudget: vi.fn(),
}));
vi.mock("../src/server/modules/businesses/businesses.service", () => ({
  assertMember: vi.fn(),
  assertManager: vi.fn(),
  recordAudit: mocks.recordAudit,
}));
vi.mock("../src/server/modules/verification/sumsub.client", () => ({
  configuredSumsubClient: () => ({ snapshot: mocks.snapshot }),
}));

import type { VerificationConfig } from "../src/server/modules/verification/verification.config";
import { VerificationProviderError } from "../src/server/modules/verification/verification.errors";
import { reconcileCase } from "../src/server/modules/verification/verification.service";

const NOW = new Date("2026-09-21T12:00:00.000Z");

const config: VerificationConfig = {
  mode: "sandbox",
  environment: "sandbox",
  appToken: "sbx:token",
  secretKey: "secret",
  webhookSecret: "hook",
  webhookAlgorithm: "HMAC_SHA256_HEX",
  levels: { individual: "olio-individual", company: "olio-company" },
  expectedClientId: null,
  timeoutMs: 15_000,
  policyVersion: 1,
  workerEnabled: true,
  operatorIds: [],
  productionRuntime: false,
};

function snapshot(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    applicantType: "individual",
    levelName: "olio-individual",
    sandboxMode: true,
    reviewStatus: "completed",
    reviewAnswer: "GREEN",
    rejectType: null,
    rejectLabels: [],
    moderationComment: null,
    evidenceComplete: true,
    pendingEvidence: [],
    associatedPersons: [],
    applicantCreatedAt: null,
    checkedAt: NOW,
    ...overrides,
  };
}

function caseDoc(
  overrides: Partial<VerificationCaseDoc> = {},
): VerificationCaseDoc {
  return {
    _id: "case_1",
    businessId: "biz_1",
    provider: "sumsub",
    environment: "sandbox",
    externalUserId: "olio-sandbox-1",
    applicantId: "app_1",
    applicantType: "individual",
    levelName: "olio-individual",
    reviewCycle: 1,
    eligibility: "pending",
    userMessage: null,
    internalReasons: [],
    snapshot: null,
    policyVersion: 1,
    providerCheckedAt: null,
    revision: 3,
    reconcileAt: NOW,
    lastEventAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function claim(doc: VerificationCaseDoc) {
  mocks.claimCase.mockResolvedValue({ doc, owner: "owner-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applyCaseUpdate.mockImplementation(
    async (
      _id: string,
      revision: number,
      update: Partial<VerificationCaseDoc>,
    ) => ({
      ...caseDoc(),
      ...update,
      revision: revision + 1,
    }),
  );
  mocks.syncCredential.mockResolvedValue({ action: "none" });
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
});

describe("authoritative reconciliation", () => {
  it("writes the policy decision derived from freshly fetched provider evidence", async () => {
    claim(caseDoc());
    mocks.snapshot.mockResolvedValue(snapshot());
    const result = await reconcileCase("case_1", "worker", {
      config,
      now: () => NOW,
    });
    expect(mocks.snapshot).toHaveBeenCalledWith("app_1");
    const [, expectedRevision, update, owner] =
      mocks.applyCaseUpdate.mock.calls[0];
    expect(expectedRevision).toBe(3);
    expect(owner).toBe("owner-1");
    expect(update.eligibility).toBe("approved");
    expect(update.providerCheckedAt).toBe(NOW);
    expect(result.changed).toBe(true);
  });

  it("applies the update under the revision it read, so a delayed writer cannot clobber newer state", async () => {
    claim(caseDoc({ revision: 9 }));
    mocks.snapshot.mockResolvedValue(snapshot());
    await reconcileCase("case_1", "worker", { config, now: () => NOW });
    expect(mocks.applyCaseUpdate.mock.calls[0][1]).toBe(9);
  });

  it("always releases the lease, including on provider failure", async () => {
    claim(caseDoc());
    mocks.snapshot.mockRejectedValue(new VerificationProviderError("upstream"));
    await expect(
      reconcileCase("case_1", "worker", { config, now: () => NOW }),
    ).rejects.toBeInstanceOf(VerificationProviderError);
    expect(mocks.releaseCase).toHaveBeenCalledWith("case_1", "owner-1");
    expect(mocks.applyCaseUpdate).not.toHaveBeenCalled();
  });

  it("schedules a near-term retry when the provider read fails", async () => {
    claim(caseDoc());
    mocks.snapshot.mockRejectedValue(new VerificationProviderError("timeout"));
    await reconcileCase("case_1", "worker", { config, now: () => NOW }).catch(
      () => {},
    );
    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "case_1", leaseOwner: "owner-1" });
    expect(update.$set.reconcileAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("does nothing for a case that has no applicant yet", async () => {
    claim(caseDoc({ applicantId: null }));
    const result = await reconcileCase("case_1", "worker", {
      config,
      now: () => NOW,
    });
    expect(result).toMatchObject({ changed: false, credential: "none" });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("refuses to reconcile a case from another environment", async () => {
    claim(caseDoc({ environment: "live" }));
    await expect(
      reconcileCase("case_1", "worker", { config, now: () => NOW }),
    ).rejects.toMatchObject({ code: "environment_mismatch" });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("fails when the lease cannot be taken", async () => {
    mocks.claimCase.mockResolvedValue(null);
    await expect(
      reconcileCase("case_1", "worker", { config, now: () => NOW }),
    ).rejects.toMatchObject({ code: "lease_lost" });
  });
});

describe("provider reset", () => {
  it("returns an approved case to needs_information and bumps the review cycle", async () => {
    claim(
      caseDoc({
        eligibility: "approved",
        reviewCycle: 1,
        snapshot: snapshot({ reviewStatus: "completed" }),
      }),
    );
    mocks.snapshot.mockResolvedValue(
      snapshot({
        reviewStatus: "init",
        reviewAnswer: null,
        evidenceComplete: false,
      }),
    );
    await reconcileCase("case_1", "worker", { config, now: () => NOW });
    const update = mocks.applyCaseUpdate.mock.calls[0][2];
    expect(update.eligibility).toBe("needs_information");
    expect(update.internalReasons).toEqual(["provider_reset"]);
    expect(update.reviewCycle).toBe(2);
  });

  it("does not treat a first-ever init status as a reset", async () => {
    claim(caseDoc({ eligibility: "not_started", snapshot: null }));
    mocks.snapshot.mockResolvedValue(
      snapshot({ reviewStatus: "init", reviewAnswer: null }),
    );
    await reconcileCase("case_1", "worker", { config, now: () => NOW });
    const update = mocks.applyCaseUpdate.mock.calls[0][2];
    expect(update.eligibility).toBe("not_started");
    expect(update.reviewCycle).toBe(1);
  });
});

describe("credential and audit side effects", () => {
  it("syncs the credential from the updated case, not the stale one", async () => {
    claim(caseDoc({ revision: 5 }));
    mocks.snapshot.mockResolvedValue(snapshot());
    mocks.syncCredential.mockResolvedValue({
      action: "issued",
      credential: { suspensionReason: null },
    });
    const result = await reconcileCase("case_1", "worker", {
      config,
      now: () => NOW,
    });
    expect(mocks.syncCredential.mock.calls[0][0].revision).toBe(6);
    expect(result.credential).toBe("issued");
  });

  it("records an audit entry for the eligibility change and the credential action", async () => {
    claim(caseDoc({ eligibility: "pending" }));
    mocks.snapshot.mockResolvedValue(snapshot());
    mocks.syncCredential.mockResolvedValue({
      action: "issued",
      credential: { suspensionReason: null },
    });
    await reconcileCase("case_1", "worker", { config, now: () => NOW });
    const actions = mocks.recordAudit.mock.calls.map(([entry]) => entry.action);
    expect(actions).toEqual([
      "verification.eligibility_changed",
      "credential.issued",
    ]);
    expect(mocks.recordAudit.mock.calls[0][0].reasonCode).toBe(
      "pending->approved",
    );
  });

  it("does not record an eligibility audit entry when nothing changed", async () => {
    claim(caseDoc({ eligibility: "approved" }));
    mocks.snapshot.mockResolvedValue(snapshot());
    await reconcileCase("case_1", "worker", { config, now: () => NOW });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("suspends the credential when a previously approved case regresses", async () => {
    claim(caseDoc({ eligibility: "approved" }));
    mocks.snapshot.mockResolvedValue(
      snapshot({
        reviewAnswer: "RED",
        rejectType: "FINAL",
        rejectLabels: ["FORGERY"],
      }),
    );
    mocks.syncCredential.mockResolvedValue({
      action: "suspended",
      credential: { suspensionReason: "eligibility_declined" },
    });
    const result = await reconcileCase("case_1", "worker", {
      config,
      now: () => NOW,
    });
    expect(mocks.applyCaseUpdate.mock.calls[0][2].eligibility).toBe("declined");
    expect(result.credential).toBe("suspended");
  });
});
