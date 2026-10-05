import type { VerificationStatus } from "../../features/verification/useVerification";

export type Eligibility = VerificationStatus["eligibility"];

export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  not_started: "Not started",
  pending: "In review",
  needs_information: "Action needed",
  manual_review: "Under review",
  approved: "Verified",
  declined: "Not approved",
};

export const ELIGIBILITY_HEADLINES: Record<Eligibility, string> = {
  not_started: "Verify once, reuse everywhere",
  pending: "Your details are being checked",
  needs_information: "One more step is needed",
  manual_review: "A reviewer is taking a look",
  approved: "Your identity is verified",
  declined: "Verification was not approved",
};

export const ELIGIBILITY_TONE: Record<
  Eligibility,
  "neutral" | "progress" | "attention" | "success" | "danger"
> = {
  not_started: "neutral",
  pending: "progress",
  needs_information: "attention",
  manual_review: "progress",
  approved: "success",
  declined: "danger",
};

export const ACTION_LABELS: Record<VerificationStatus["nextAction"], string> = {
  create_business: "Create profile",
  start: "Start verification",
  continue: "Continue verification",
  wait: "Check status",
  resubmit: "Resubmit details",
  contact_support: "Contact support",
  done: "Open passport",
};

export function formatDateTime(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
