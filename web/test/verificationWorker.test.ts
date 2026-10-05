// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/server/modules/notifications/notifications.service", () => ({
  deliverNotifications: vi.fn(),
}));
import type {
  VerificationCaseDoc,
  VerificationEventDoc,
} from "../src/server/db/mongo";

const mocks = vi.hoisted(() => ({
  cases: [] as VerificationCaseDoc[],
  claimNextEvent: vi.fn(),
  claimDueCase: vi.fn(),
  finishEvent: vi.fn(),
  reconcileCase: vi.fn(),
  refreshWorkerHeartbeat: vi.fn(),
  updateOne: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../src/server/db/mongo", () => ({
  getVerificationCases: async () => ({
    findOne: mocks.findOne,
    updateOne: mocks.updateOne,
  }),
}));
vi.mock(
  "../src/server/modules/verification/verification.storage",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/server/modules/verification/verification.storage")
    >()),
    claimNextEvent: mocks.claimNextEvent,
    claimDueCase: mocks.claimDueCase,
    finishEvent: mocks.finishEvent,
    refreshWorkerHeartbeat: mocks.refreshWorkerHeartbeat,
  }),
);
vi.mock("../src/server/modules/verification/verification.service", () => ({
  reconcileCase: mocks.reconcileCase,
}));

import type { VerificationConfig } from "../src/server/modules/verification/verification.config";
import {
  VerificationProviderError,
  VerificationStateError,
} from "../src/server/modules/verification/verification.errors";
import {
  errorCode,
  MAX_BACKOFF_MS,
  processNextEvent,
  reconcileNextDueCase,
  retryDelayMs,
  runVerificationWorker,
} from "../src/server/modules/verification/verification.worker";

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

function event(
  overrides: Partial<VerificationEventDoc> = {},
): VerificationEventDoc {
  return {
    _id: "evt_1",
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
    attempts: 1,
    nextAttemptAt: new Date(),
    receivedAt: new Date("2026-09-21T10:00:00.000Z"),
    ...overrides,
  };
}

function caseDoc(
  overrides: Partial<VerificationCaseDoc> = {},
): VerificationCaseDoc {
  const now = new Date();
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
    revision: 1,
    reconcileAt: now,
    lastEventAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cases.length = 0;
  mocks.findOne.mockResolvedValue(caseDoc());
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.reconcileCase.mockResolvedValue({
    doc: caseDoc({ eligibility: "approved", revision: 2 }),
    changed: true,
    credential: "issued",
  });
  mocks.refreshWorkerHeartbeat.mockResolvedValue(undefined);
  mocks.finishEvent.mockResolvedValue(undefined);
});

describe("retry policy", () => {
  it("backs off exponentially and caps the delay", () => {
    expect(retryDelayMs(0, null, 0.5)).toBeGreaterThanOrEqual(5000 * 0.8);
    expect(retryDelayMs(20, null, 0.5)).toBeLessThanOrEqual(
      MAX_BACKOFF_MS * 1.2,
    );
    expect(retryDelayMs(3, null, 0.5)).toBeGreaterThan(
      retryDelayMs(1, null, 0.5),
    );
  });

  it("honours a provider retry-after that exceeds the backoff", () => {
    const throttled = new VerificationProviderError("throttled", 600_000);
    expect(retryDelayMs(0, throttled, 0.5)).toBeGreaterThanOrEqual(600_000);
  });

  it("labels errors without leaking provider payloads", () => {
    expect(errorCode(new VerificationProviderError("timeout"))).toBe(
      "provider_timeout",
    );
    expect(errorCode(new VerificationStateError("lease_lost"))).toBe(
      "state_lease_lost",
    );
    expect(errorCode(new Error("applicant John Doe rejected"))).toBe(
      "unexpected",
    );
  });
});

describe("event processing", () => {
  it("reconciles the mapped case and marks the event done", async () => {
    mocks.claimNextEvent.mockResolvedValue({ doc: event(), owner: "owner-1" });
    const outcome = await processNextEvent({ config });
    expect(outcome).toEqual({
      status: "done",
      eventId: "evt_1",
      caseId: "case_1",
    });
    expect(mocks.reconcileCase).toHaveBeenCalledWith("case_1", "worker", {
      config,
      submissionReceivedAt: event().receivedAt,
    });
    expect(mocks.finishEvent.mock.calls[0][2]).toMatchObject({ state: "done" });
  });

  it("records the notification time without overwriting a newer one", async () => {
    mocks.claimNextEvent.mockResolvedValue({ doc: event(), owner: "owner-1" });
    await processNextEvent({ config });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: "case_1" },
      { $max: { lastEventAt: new Date("2026-09-21T10:00:00.000Z") } },
    );
  });

  it("parks a notification that maps to no known case", async () => {
    mocks.findOne.mockResolvedValue(null);
    mocks.claimNextEvent.mockResolvedValue({ doc: event(), owner: "owner-1" });
    const outcome = await processNextEvent({ config });
    expect(outcome).toMatchObject({ status: "parked", error: "unknown_case" });
    expect(mocks.reconcileCase).not.toHaveBeenCalled();
  });

  it("parks a notification whose applicant does not match the stored case", async () => {
    mocks.findOne.mockResolvedValue(caseDoc({ applicantId: "app_other" }));
    mocks.claimNextEvent.mockResolvedValue({ doc: event(), owner: "owner-1" });
    const outcome = await processNextEvent({ config });
    expect(outcome).toMatchObject({
      status: "parked",
      error: "applicant_mismatch",
    });
    expect(mocks.reconcileCase).not.toHaveBeenCalled();
  });

  it("retries a provider outage with backoff instead of dropping the event", async () => {
    mocks.reconcileCase.mockRejectedValue(
      new VerificationProviderError("upstream"),
    );
    mocks.claimNextEvent.mockResolvedValue({ doc: event(), owner: "owner-1" });
    const outcome = await processNextEvent({ config });
    expect(outcome).toMatchObject({
      status: "retry",
      error: "provider_upstream",
    });
    const update = mocks.finishEvent.mock.calls[0][2];
    expect(update.state).toBe("queued");
    expect(update.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("parks a non-retryable failure", async () => {
    mocks.reconcileCase.mockRejectedValue(
      new VerificationProviderError("denied"),
    );
    mocks.claimNextEvent.mockResolvedValue({ doc: event(), owner: "owner-1" });
    expect(await processNextEvent({ config })).toMatchObject({
      status: "parked",
      error: "provider_denied",
    });
  });

  it("parks an event that has exhausted its attempts", async () => {
    mocks.reconcileCase.mockRejectedValue(
      new VerificationProviderError("timeout"),
    );
    mocks.claimNextEvent.mockResolvedValue({
      doc: event({ attempts: 9 }),
      owner: "owner-1",
    });
    expect(await processNextEvent({ config })).toMatchObject({
      status: "parked",
    });
  });

  it("is idle when nothing is queued", async () => {
    mocks.claimNextEvent.mockResolvedValue(null);
    expect(await processNextEvent({ config })).toEqual({ status: "idle" });
  });
});

describe("scheduled reconciliation", () => {
  it("reuses the claim it already holds when reconciling a due case", async () => {
    const claimed = { doc: caseDoc(), owner: "owner-2" };
    mocks.claimDueCase.mockResolvedValue(claimed);
    const outcome = await reconcileNextDueCase({ config });
    expect(outcome).toEqual({
      status: "done",
      caseId: "case_1",
      changed: true,
    });
    expect(mocks.reconcileCase).toHaveBeenCalledWith(
      "case_1",
      "worker",
      { config },
      claimed,
    );
  });

  it("finds an approved case that no notification ever arrived for", async () => {
    mocks.claimDueCase.mockResolvedValue({
      doc: caseDoc({ eligibility: "approved", lastEventAt: null }),
      owner: "owner-2",
    });
    mocks.reconcileCase.mockResolvedValue({
      doc: caseDoc({ eligibility: "declined", revision: 3 }),
      changed: true,
      credential: "suspended",
    });
    expect(await reconcileNextDueCase({ config })).toMatchObject({
      status: "done",
      changed: true,
    });
  });

  it("does not push the schedule back when the provider is down", async () => {
    mocks.claimDueCase.mockResolvedValue({ doc: caseDoc(), owner: "owner-2" });
    mocks.reconcileCase.mockRejectedValue(
      new VerificationProviderError("upstream"),
    );
    expect(await reconcileNextDueCase({ config })).toMatchObject({
      status: "retry",
      error: "provider_upstream",
    });
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("reschedules after an unexpected failure", async () => {
    mocks.claimDueCase.mockResolvedValue({ doc: caseDoc(), owner: "owner-2" });
    mocks.reconcileCase.mockRejectedValue(new Error("boom"));
    expect(await reconcileNextDueCase({ config })).toMatchObject({
      status: "retry",
      error: "unexpected",
    });
    expect(mocks.updateOne).toHaveBeenCalled();
  });
});

describe("worker run", () => {
  it("stays disabled unless explicitly enabled", async () => {
    const run = await runVerificationWorker({
      deps: { config: { ...config, workerEnabled: false } },
    });
    expect(run.status).toBe("disabled");
    expect(mocks.refreshWorkerHeartbeat).not.toHaveBeenCalled();
  });

  it("stays disabled when the provider mode is off", async () => {
    const run = await runVerificationWorker({
      deps: { config: { ...config, mode: "off", environment: null } },
    });
    expect(run.status).toBe("disabled");
  });

  it("drains events then due cases and reports both", async () => {
    const events = [
      { status: "done", eventId: "e1", caseId: "c1" },
      { status: "retry", eventId: "e2", error: "provider_timeout" },
      { status: "idle" },
    ];
    const cases = [
      { status: "done", caseId: "c9", changed: false },
      { status: "idle" },
    ];
    const run = await runVerificationWorker({
      deps: { config },
      processEvent: async () => events.shift() as never,
      reconcileCase: async () => cases.shift() as never,
    });
    expect(run).toMatchObject({
      status: "completed",
      events: { done: 1, retried: 1, parked: 0 },
      cases: { done: 1, retried: 0 },
      exhausted: false,
    });
    expect(mocks.refreshWorkerHeartbeat).toHaveBeenCalled();
  });

  it("stops instead of looping on the same stuck event", async () => {
    let calls = 0;
    const run = await runVerificationWorker({
      deps: { config },
      processEvent: async () => {
        calls += 1;
        return { status: "retry", eventId: "stuck", error: "provider_timeout" };
      },
      reconcileCase: async () => ({ status: "idle" }),
    });
    expect(calls).toBe(2);
    expect(run.status).toBe("pending");
  });

  it("reports idle when there is nothing to do", async () => {
    const run = await runVerificationWorker({
      deps: { config },
      processEvent: async () => ({ status: "idle" }),
      reconcileCase: async () => ({ status: "idle" }),
    });
    expect(run).toMatchObject({
      status: "idle",
      events: { done: 0, retried: 0, parked: 0 },
      cases: { done: 0, retried: 0 },
    });
  });

  it("stops at the drain budget and says so", async () => {
    const run = await runVerificationWorker({
      budgetMs: 0,
      deps: { config },
      processEvent: async () => ({ status: "done", eventId: "e", caseId: "c" }),
      reconcileCase: async () => ({
        status: "done",
        caseId: "c",
        changed: false,
      }),
    });
    expect(run.exhausted).toBe(true);
    expect(run.events.done).toBe(0);
  });
});
