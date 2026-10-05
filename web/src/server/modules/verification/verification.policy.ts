import type {
  BusinessType,
  EligibilityState,
  ProviderSnapshot,
  VerificationEnvironment,
} from "../../db/mongo";

export const CREDENTIAL_VALIDITY_MS = 365 * 86_400_000;
export const CREDENTIAL_STALE_AFTER_MS = 7 * 86_400_000;
export const OPEN_CASE_RECONCILE_MS = 60 * 60_000;
export const APPROVED_CASE_RECONCILE_MS = 24 * 60 * 60_000;
export const TERMINAL_CASE_RECONCILE_MS = 7 * 24 * 60 * 60_000;

export const SCREENING_LABELS = [
  "COMPROMISED_PERSONS",
  "PEP",
  "SANCTIONS",
  "ADVERSE_MEDIA",
  "CRIMINAL",
];

export const USER_MESSAGES = {
  pending: "Your details are being checked. This usually takes a few minutes.",
  needs_information:
    "Something in your submission needs another look. Continue verification to resubmit.",
  manual_review:
    "Your verification is under review. You will see the result here once it is complete.",
  approved:
    "Identity verified. You can now decide whether to publish your badge.",
  declined:
    "Verification could not be completed for this business. Contact support if you believe this is a mistake.",
  not_started: null,
} as const satisfies Record<EligibilityState, string | null>;

export type PolicyInput = {
  snapshot: ProviderSnapshot;
  expectedType: BusinessType;
  expectedLevel: string;
  environment: VerificationEnvironment;
  policyVersion: number;
};

export type PolicyDecision = {
  eligibility: EligibilityState;
  userMessage: string | null;
  internalReasons: string[];
};

function decision(
  eligibility: EligibilityState,
  internalReasons: string[],
): PolicyDecision {
  return {
    eligibility,
    userMessage: USER_MESSAGES[eligibility],
    internalReasons,
  };
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { snapshot } = input;
  const reasons: string[] = [];

  if (snapshot.applicantType !== input.expectedType) {
    reasons.push("applicant_type_mismatch");
  }
  if (snapshot.levelName && snapshot.levelName !== input.expectedLevel) {
    reasons.push("level_mismatch");
  }
  const expectedSandbox = input.environment === "sandbox";
  if (
    snapshot.sandboxMode !== null &&
    snapshot.sandboxMode !== expectedSandbox
  ) {
    reasons.push("environment_mismatch");
  }
  if (reasons.length > 0) return decision("manual_review", reasons);

  switch (snapshot.reviewStatus) {
    case null:
    case "init":
      return decision("not_started", ["provider_init"]);
    case "awaitingUser":
      return decision("needs_information", ["awaiting_user"]);
    case "pending":
    case "prechecked":
    case "queued":
    case "awaitingService":
      return decision("pending", [`provider_${snapshot.reviewStatus}`]);
    case "onHold":
      return decision("manual_review", ["provider_on_hold"]);
    case "completed":
      break;
  }

  if (snapshot.reviewAnswer === "RED") {
    const screening = snapshot.rejectLabels.filter((label) =>
      SCREENING_LABELS.includes(label),
    );
    if (screening.length > 0) {
      return decision("manual_review", ["screening_hit"]);
    }
    if (snapshot.rejectType === "RETRY") {
      return decision("needs_information", ["provider_retry"]);
    }
    return decision("declined", ["provider_final"]);
  }

  if (snapshot.reviewAnswer !== "GREEN") {
    return decision("manual_review", ["completed_without_answer"]);
  }

  if (!snapshot.evidenceComplete) {
    return decision("manual_review", ["evidence_incomplete"]);
  }

  if (input.expectedType === "company") {
    if (snapshot.associatedPersons.length === 0) {
      return decision("manual_review", ["no_associated_persons"]);
    }
    const unresolved = snapshot.associatedPersons.filter(
      (person) =>
        person.reviewStatus !== "completed" || person.reviewAnswer !== "GREEN",
    );
    if (unresolved.length > 0) {
      const anyRed = unresolved.some((person) => person.reviewAnswer === "RED");
      return decision(anyRed ? "manual_review" : "pending", [
        anyRed ? "associated_person_rejected" : "associated_person_pending",
      ]);
    }
  }

  return decision("approved", ["provider_green"]);
}

export function nextReconcileAt(
  eligibility: EligibilityState,
  now: Date,
): Date {
  if (eligibility === "approved") {
    return new Date(now.getTime() + APPROVED_CASE_RECONCILE_MS);
  }
  if (eligibility === "declined") {
    return new Date(now.getTime() + TERMINAL_CASE_RECONCILE_MS);
  }
  return new Date(now.getTime() + OPEN_CASE_RECONCILE_MS);
}

export function credentialValidUntil(checkedAt: Date): Date {
  return new Date(checkedAt.getTime() + CREDENTIAL_VALIDITY_MS);
}

export function credentialIsFresh(checkedAt: Date, now: Date): boolean {
  return now.getTime() - checkedAt.getTime() <= CREDENTIAL_STALE_AFTER_MS;
}

export function credentialIsCurrent(
  credential: {
    status: "active" | "suspended";
    checkedAt: Date;
    validUntil: Date;
  },
  now: Date,
): boolean {
  return (
    credential.status === "active" &&
    credential.validUntil.getTime() > now.getTime() &&
    credentialIsFresh(credential.checkedAt, now)
  );
}
