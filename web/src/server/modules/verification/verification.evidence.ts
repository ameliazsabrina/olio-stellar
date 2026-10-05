import type { ProviderSnapshot, VerificationEnvironment } from "../../db/mongo";
export function submissionEvidence(
  snapshot: ProviderSnapshot | null | undefined,
  environment: VerificationEnvironment,
): boolean {
  return (
    !!snapshot &&
    snapshot.sandboxMode === (environment === "sandbox") &&
    [
      "pending",
      "prechecked",
      "queued",
      "awaitingService",
      "onHold",
      "completed",
    ].includes(snapshot.reviewStatus ?? "")
  );
}
