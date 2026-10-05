import "server-only";
import { deliverNotifications } from "../notifications/notifications.service";
import { getVerificationCases } from "../../db/mongo";
import { verificationConfig } from "./verification.config";
import {
  isRetryable,
  VerificationProviderError,
  VerificationStateError,
} from "./verification.errors";
import { type ReconcileDeps, reconcileCase } from "./verification.service";
import {
  claimDueCase,
  claimNextEvent,
  finishEvent,
  MAX_EVENT_ATTEMPTS,
  refreshWorkerHeartbeat,
} from "./verification.storage";

export const DEFAULT_DRAIN_BUDGET_MS = 240_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

export function retryDelayMs(
  attempts: number,
  error: unknown,
  random = Math.random(),
): number {
  const jitter = 0.8 + random * 0.4;
  const backoff =
    Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(attempts, 7)) * jitter;
  const retryAfter =
    error instanceof VerificationProviderError ? error.retryAfterMs : 0;
  return Math.max(backoff, retryAfter);
}

export function errorCode(error: unknown): string {
  if (error instanceof VerificationProviderError)
    return `provider_${error.code}`;
  if (error instanceof VerificationStateError) return `state_${error.code}`;
  return "unexpected";
}

export type EventOutcome =
  | { status: "idle" }
  | { status: "done"; eventId: string; caseId: string | null }
  | { status: "retry"; eventId: string; error: string }
  | { status: "parked"; eventId: string; error: string };

export async function processNextEvent(
  deps: ReconcileDeps = {},
): Promise<EventOutcome> {
  const now = deps.now?.() ?? new Date();
  const claimed = await claimNextEvent(now);
  if (!claimed) return { status: "idle" };
  const { doc: event, owner } = claimed;
  const cases = await getVerificationCases();
  const filter = event.externalUserId
    ? {
        provider: "sumsub" as const,
        environment: event.environment,
        externalUserId: event.externalUserId,
      }
    : event.applicantId
      ? {
          provider: "sumsub" as const,
          environment: event.environment,
          applicantId: event.applicantId,
        }
      : null;
  const target = filter ? await cases.findOne(filter) : null;
  if (!target) {
    await finishEvent(
      event._id,
      owner,
      { state: "parked", error: "unknown_case" },
      now,
    );
    return { status: "parked", eventId: event._id, error: "unknown_case" };
  }
  if (
    event.applicantId &&
    target.applicantId &&
    event.applicantId !== target.applicantId
  ) {
    await finishEvent(
      event._id,
      owner,
      { state: "parked", error: "applicant_mismatch" },
      now,
    );
    return {
      status: "parked",
      eventId: event._id,
      error: "applicant_mismatch",
    };
  }
  await cases.updateOne(
    { _id: target._id },
    { $max: { lastEventAt: event.receivedAt } },
  );
  try {
    await reconcileCase(target._id, "worker", {
      ...deps,
      ...(["applicantPending", "applicantReviewed", "applicantOnHold"].includes(
        event.type,
      ) &&
      event.applicantId === target.applicantId &&
      event.environment === target.environment
        ? { submissionReceivedAt: event.receivedAt }
        : {}),
    });
    await finishEvent(
      event._id,
      owner,
      { state: "done", caseId: target._id },
      now,
    );
    return { status: "done", eventId: event._id, caseId: target._id };
  } catch (error) {
    const code = errorCode(error);
    if (isRetryable(error) && event.attempts < MAX_EVENT_ATTEMPTS) {
      const delay = retryDelayMs(event.attempts, error);
      await finishEvent(
        event._id,
        owner,
        {
          state: "queued",
          nextAttemptAt: new Date(now.getTime() + delay),
          error: code,
        },
        now,
      );
      return { status: "retry", eventId: event._id, error: code };
    }
    await finishEvent(event._id, owner, { state: "parked", error: code }, now);
    return { status: "parked", eventId: event._id, error: code };
  }
}

export type CaseOutcome =
  | { status: "idle" }
  | { status: "done"; caseId: string; changed: boolean }
  | { status: "retry"; caseId: string; error: string };

export async function reconcileNextDueCase(
  deps: ReconcileDeps = {},
): Promise<CaseOutcome> {
  const now = deps.now?.() ?? new Date();
  const claimed = await claimDueCase(now);
  if (!claimed) return { status: "idle" };
  try {
    const result = await reconcileCase(
      claimed.doc._id,
      "worker",
      deps,
      claimed,
    );
    return { status: "done", caseId: claimed.doc._id, changed: result.changed };
  } catch (error) {
    const code = errorCode(error);
    if (!(error instanceof VerificationProviderError)) {
      await (await getVerificationCases()).updateOne(
        { _id: claimed.doc._id },
        {
          $set: {
            reconcileAt: new Date(now.getTime() + retryDelayMs(1, error)),
          },
        },
      );
    }
    return { status: "retry", caseId: claimed.doc._id, error: code };
  }
}

export type WorkerRun = {
  status: "disabled" | "idle" | "completed" | "pending";
  events: { done: number; retried: number; parked: number };
  cases: { done: number; retried: number };
  exhausted: boolean;
  durationMs: number;
};

export async function runVerificationWorker(
  options: {
    budgetMs?: number;
    deps?: ReconcileDeps;
    processEvent?: () => Promise<EventOutcome>;
    reconcileCase?: () => Promise<CaseOutcome>;
  } = {},
): Promise<WorkerRun> {
  const started = Date.now();
  const summary: WorkerRun = {
    status: "idle",
    events: { done: 0, retried: 0, parked: 0 },
    cases: { done: 0, retried: 0 },
    exhausted: false,
    durationMs: 0,
  };
  const config = options.deps?.config ?? verificationConfig();
  if (!config.workerEnabled || config.mode === "off") {
    return { ...summary, status: "disabled" };
  }
  await deliverNotifications();
  const budgetMs = options.budgetMs ?? DEFAULT_DRAIN_BUDGET_MS;
  const processEvent =
    options.processEvent ?? (() => processNextEvent(options.deps));
  const reconcileDue =
    options.reconcileCase ?? (() => reconcileNextDueCase(options.deps));
  await refreshWorkerHeartbeat();
  const seenEvents = new Set<string>();
  while (Date.now() - started < budgetMs) {
    const outcome = await processEvent();
    if (outcome.status === "idle") break;
    if (outcome.status === "done") summary.events.done += 1;
    else if (outcome.status === "retry") summary.events.retried += 1;
    else summary.events.parked += 1;
    if (seenEvents.has(outcome.eventId)) break;
    seenEvents.add(outcome.eventId);
    await refreshWorkerHeartbeat();
  }
  const seenCases = new Set<string>();
  while (Date.now() - started < budgetMs) {
    const outcome = await reconcileDue();
    if (outcome.status === "idle") break;
    if (outcome.status === "done") summary.cases.done += 1;
    else summary.cases.retried += 1;
    if (seenCases.has(outcome.caseId)) break;
    seenCases.add(outcome.caseId);
    await refreshWorkerHeartbeat();
  }
  await deliverNotifications();
  summary.exhausted = Date.now() - started >= budgetMs;
  const processed =
    summary.events.done +
    summary.events.retried +
    summary.events.parked +
    summary.cases.done +
    summary.cases.retried;
  summary.status =
    processed === 0
      ? "idle"
      : summary.events.done + summary.cases.done > 0
        ? "completed"
        : "pending";
  summary.durationMs = Date.now() - started;
  return summary;
}
