import "server-only";
import {
  type EligibilityState,
  getVerificationCases,
  getVerificationEvents,
} from "../../db/mongo";
import { readiness, verificationConfig } from "./verification.config";
import { storageReady, workerAlive } from "./verification.storage";

export type VerificationHealth = {
  status: "ok" | "degraded" | "disabled";
  checkedAt: string;
  mode: "off" | "sandbox" | "live";
  readiness: string;
  storageReady: boolean;
  worker: { enabled: boolean; alive: boolean; until: string | null };
  cases: Record<EligibilityState, number>;
  events: { queued: number; parked: number; oldestQueuedAgeMs: number | null };
};

const ELIGIBILITIES: EligibilityState[] = [
  "not_started",
  "pending",
  "needs_information",
  "manual_review",
  "approved",
  "declined",
];

export async function verificationHealth(
  now = new Date(),
): Promise<VerificationHealth> {
  const config = verificationConfig();
  const ready = readiness(config);
  const storage = await storageReady();
  const until = await workerAlive(now);
  const cases = await getVerificationCases();
  const events = await getVerificationEvents();
  const scope = config.environment ? { environment: config.environment } : {};
  const counts = Object.fromEntries(
    await Promise.all(
      ELIGIBILITIES.map(async (eligibility) => [
        eligibility,
        await cases.countDocuments({ ...scope, eligibility }),
      ]),
    ),
  ) as Record<EligibilityState, number>;
  const queued = await events.countDocuments({ ...scope, state: "queued" });
  const parked = await events.countDocuments({ ...scope, state: "parked" });
  const [oldest] = await events
    .find({ ...scope, state: "queued" }, { projection: { receivedAt: 1 } })
    .sort({ receivedAt: 1 })
    .limit(1)
    .toArray();
  const alive = until !== null;
  const status =
    config.mode === "off"
      ? "disabled"
      : ready.ready &&
          storage &&
          (!config.workerEnabled || alive) &&
          parked === 0
        ? "ok"
        : "degraded";
  return {
    status,
    checkedAt: now.toISOString(),
    mode: config.mode,
    readiness: ready.ready ? "ready" : ready.reason,
    storageReady: storage,
    worker: {
      enabled: config.workerEnabled,
      alive,
      until: until?.toISOString() ?? null,
    },
    cases: counts,
    events: {
      queued,
      parked,
      oldestQueuedAgeMs: oldest
        ? now.getTime() - oldest.receivedAt.getTime()
        : null,
    },
  };
}
