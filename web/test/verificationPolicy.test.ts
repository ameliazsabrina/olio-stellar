// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../src/server/db/mongo";
import {
  APPROVED_CASE_RECONCILE_MS,
  CREDENTIAL_STALE_AFTER_MS,
  credentialIsCurrent,
  credentialIsFresh,
  credentialValidUntil,
  evaluatePolicy,
  nextReconcileAt,
  OPEN_CASE_RECONCILE_MS,
  TERMINAL_CASE_RECONCILE_MS,
} from "../src/server/modules/verification/verification.policy";

const CHECKED_AT = new Date("2026-09-21T10:00:00.000Z");

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
    applicantCreatedAt: "2026-09-20 10:00:00",
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<ProviderSnapshot> = {},
  expected: { type?: "individual" | "company"; level?: string } = {},
) {
  return evaluatePolicy({
    snapshot: snapshot(overrides),
    expectedType: expected.type ?? "individual",
    expectedLevel: expected.level ?? "olio-individual",
    environment: "sandbox",
    policyVersion: 1,
  });
}

describe("individual completeness", () => {
  it("approves a completed green applicant with complete evidence", () => {
    const decision = evaluate();
    expect(decision.eligibility).toBe("approved");
    expect(decision.internalReasons).toEqual(["provider_green"]);
    expect(decision.userMessage).toMatch(/Identity verified/);
  });

  it("never approves a green answer while required documents are outstanding", () => {
    const decision = evaluate({
      evidenceComplete: false,
      pendingEvidence: ["SELFIE"],
    });
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toEqual(["evidence_incomplete"]);
  });

  it("keeps an in-progress applicant out of any decided state", () => {
    expect(
      evaluate({ reviewStatus: "pending", reviewAnswer: null }).eligibility,
    ).toBe("pending");
    expect(
      evaluate({ reviewStatus: "queued", reviewAnswer: null }).eligibility,
    ).toBe("pending");
    expect(
      evaluate({ reviewStatus: "awaitingService", reviewAnswer: null })
        .eligibility,
    ).toBe("pending");
    expect(
      evaluate({ reviewStatus: "init", reviewAnswer: null }).eligibility,
    ).toBe("not_started");
    expect(
      evaluate({ reviewStatus: "awaitingUser", reviewAnswer: null })
        .eligibility,
    ).toBe("needs_information");
    expect(
      evaluate({ reviewStatus: "onHold", reviewAnswer: null }).eligibility,
    ).toBe("manual_review");
  });

  it("treats a completed review with no answer as needing a human", () => {
    const decision = evaluate({ reviewAnswer: null });
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toEqual(["completed_without_answer"]);
  });
});

describe("rejection handling", () => {
  it("asks for more information on a RETRY rejection", () => {
    const decision = evaluate({
      reviewAnswer: "RED",
      rejectType: "RETRY",
      rejectLabels: ["BAD_PROOF_OF_IDENTITY"],
      moderationComment: "Photo is blurry",
    });
    expect(decision.eligibility).toBe("needs_information");
    expect(decision.userMessage).not.toContain("BAD_PROOF_OF_IDENTITY");
  });

  it("declines on a FINAL rejection", () => {
    const decision = evaluate({
      reviewAnswer: "RED",
      rejectType: "FINAL",
      rejectLabels: ["FORGERY"],
    });
    expect(decision.eligibility).toBe("declined");
    expect(decision.internalReasons).toEqual(["provider_final"]);
  });

  it("routes screening hits to review rather than an automatic rejection", () => {
    for (const label of [
      "PEP",
      "SANCTIONS",
      "COMPROMISED_PERSONS",
      "ADVERSE_MEDIA",
    ]) {
      const decision = evaluate({
        reviewAnswer: "RED",
        rejectType: "FINAL",
        rejectLabels: [label],
      });
      expect(decision.eligibility).toBe("manual_review");
      expect(decision.internalReasons).toEqual(["screening_hit"]);
      expect(decision.userMessage).not.toContain(label);
    }
  });
});

describe("company completeness", () => {
  const company = { type: "company" as const, level: "olio-company" };

  it("approves only when the company and every associated person are green", () => {
    const decision = evaluate(
      {
        applicantType: "company",
        levelName: "olio-company",
        associatedPersons: [
          {
            applicantId: "a",
            role: "director",
            reviewStatus: "completed",
            reviewAnswer: "GREEN",
          },
          {
            applicantId: "b",
            role: "ubo",
            reviewStatus: "completed",
            reviewAnswer: "GREEN",
          },
        ],
      },
      company,
    );
    expect(decision.eligibility).toBe("approved");
  });

  it("refuses to publish a company with no associated persons on record", () => {
    const decision = evaluate(
      {
        applicantType: "company",
        levelName: "olio-company",
        associatedPersons: [],
      },
      company,
    );
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toEqual(["no_associated_persons"]);
  });

  it("waits while an owner check is still running", () => {
    const decision = evaluate(
      {
        applicantType: "company",
        levelName: "olio-company",
        associatedPersons: [
          {
            applicantId: "a",
            role: "director",
            reviewStatus: "completed",
            reviewAnswer: "GREEN",
          },
          {
            applicantId: "b",
            role: "ubo",
            reviewStatus: "pending",
            reviewAnswer: null,
          },
        ],
      },
      company,
    );
    expect(decision.eligibility).toBe("pending");
    expect(decision.internalReasons).toEqual(["associated_person_pending"]);
  });

  it("sends a rejected owner to review instead of approving the company", () => {
    const decision = evaluate(
      {
        applicantType: "company",
        levelName: "olio-company",
        associatedPersons: [
          {
            applicantId: "b",
            role: "ubo",
            reviewStatus: "completed",
            reviewAnswer: "RED",
          },
        ],
      },
      company,
    );
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toEqual(["associated_person_rejected"]);
  });

  it("does not let a company result satisfy an individual case or vice versa", () => {
    expect(
      evaluate({ applicantType: "company", levelName: "olio-company" })
        .internalReasons,
    ).toContain("applicant_type_mismatch");
    expect(evaluate({}, company).internalReasons).toContain(
      "applicant_type_mismatch",
    );
  });
});

describe("environment and level guards", () => {
  it("refuses to approve a live applicant in a sandbox deployment", () => {
    const decision = evaluatePolicy({
      snapshot: snapshot({ sandboxMode: false }),
      expectedType: "individual",
      expectedLevel: "olio-individual",
      environment: "sandbox",
      policyVersion: 1,
    });
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toContain("environment_mismatch");
  });

  it("refuses to approve a sandbox applicant in a live deployment", () => {
    const decision = evaluatePolicy({
      snapshot: snapshot({ sandboxMode: true }),
      expectedType: "individual",
      expectedLevel: "olio-individual",
      environment: "live",
      policyVersion: 1,
    });
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toContain("environment_mismatch");
  });

  it("refuses to approve a result produced at a different level", () => {
    const decision = evaluate({ levelName: "some-other-level" });
    expect(decision.eligibility).toBe("manual_review");
    expect(decision.internalReasons).toContain("level_mismatch");
  });
});

describe("freshness and scheduling", () => {
  it("re-checks open cases sooner than approved ones and declined ones last", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    expect(nextReconcileAt("pending", now).getTime()).toBe(
      now.getTime() + OPEN_CASE_RECONCILE_MS,
    );
    expect(nextReconcileAt("approved", now).getTime()).toBe(
      now.getTime() + APPROVED_CASE_RECONCILE_MS,
    );
    expect(nextReconcileAt("declined", now).getTime()).toBe(
      now.getTime() + TERMINAL_CASE_RECONCILE_MS,
    );
  });

  it("treats evidence older than the freshness window as stale", () => {
    const now = new Date(CHECKED_AT.getTime() + CREDENTIAL_STALE_AFTER_MS + 1);
    expect(credentialIsFresh(CHECKED_AT, now)).toBe(false);
    expect(
      credentialIsFresh(
        CHECKED_AT,
        new Date(CHECKED_AT.getTime() + 86_400_000),
      ),
    ).toBe(true);
  });

  it("only counts an active, unexpired, fresh credential as current", () => {
    const validUntil = credentialValidUntil(CHECKED_AT);
    const soon = new Date(CHECKED_AT.getTime() + 86_400_000);
    expect(
      credentialIsCurrent(
        { status: "active", checkedAt: CHECKED_AT, validUntil },
        soon,
      ),
    ).toBe(true);
    expect(
      credentialIsCurrent(
        { status: "suspended", checkedAt: CHECKED_AT, validUntil },
        soon,
      ),
    ).toBe(false);
    expect(
      credentialIsCurrent(
        { status: "active", checkedAt: CHECKED_AT, validUntil },
        new Date(validUntil.getTime() + 1),
      ),
    ).toBe(false);
    expect(
      credentialIsCurrent(
        { status: "active", checkedAt: CHECKED_AT, validUntil },
        new Date(CHECKED_AT.getTime() + CREDENTIAL_STALE_AFTER_MS + 1),
      ),
    ).toBe(false);
  });
});
