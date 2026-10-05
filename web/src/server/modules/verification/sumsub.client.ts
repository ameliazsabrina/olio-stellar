import "server-only";
import { createHmac } from "node:crypto";
import type {
  BusinessType,
  ProviderReviewStatus,
  ProviderSnapshot,
} from "../../db/mongo";
import {
  SDK_TOKEN_TTL_SECONDS,
  SUMSUB_API_ORIGIN,
  verificationConfig,
} from "./verification.config";
import {
  VerificationConfigError,
  VerificationProviderError,
} from "./verification.errors";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SumsubClientOptions = {
  appToken: string;
  secretKey: string;
  origin?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type ApplicantRecord = {
  id: string;
  externalUserId: string | null;
  type: BusinessType;
  createdAt: string | null;
  sandboxMode: boolean | null;
  levelName: string | null;
  reviewStatus: ProviderReviewStatus | null;
  reviewAnswer: "GREEN" | "RED" | null;
  rejectType: "FINAL" | "RETRY" | null;
  rejectLabels: string[];
  moderationComment: string | null;
  associatedPersonIds: { applicantId: string; role: string }[];
};

export type ReviewStatusRecord = {
  levelName: string | null;
  reviewStatus: ProviderReviewStatus | null;
  reviewAnswer: "GREEN" | "RED" | null;
  rejectType: "FINAL" | "RETRY" | null;
  rejectLabels: string[];
  moderationComment: string | null;
};

export type RequiredEvidence = { complete: boolean; pending: string[] };

export type SumsubClient = {
  ensureApplicant(input: {
    externalUserId: string;
    type: BusinessType;
    levelName: string;
  }): Promise<{ applicantId: string; created: boolean }>;
  createSdkToken(input: {
    externalUserId: string;
    levelName: string;
    ttlInSecs?: number;
  }): Promise<{ token: string; ttlInSecs: number }>;
  getApplicantByExternalId(
    externalUserId: string,
  ): Promise<ApplicantRecord | null>;
  getApplicant(applicantId: string): Promise<ApplicantRecord>;
  getApplicantStatus(applicantId: string): Promise<ReviewStatusRecord>;
  getRequiredEvidence(applicantId: string): Promise<RequiredEvidence>;
  snapshot(applicantId: string): Promise<ProviderSnapshot>;
};

const REVIEW_STATUSES: ProviderReviewStatus[] = [
  "init",
  "pending",
  "prechecked",
  "queued",
  "completed",
  "onHold",
  "awaitingUser",
  "awaitingService",
];

const RETRY_DELAYS_MS = [300, 900];

export function signRequest(
  secretKey: string,
  ts: number,
  method: string,
  pathWithQuery: string,
  body: string | undefined,
): string {
  const payload = `${ts}${method.toUpperCase()}${pathWithQuery}${body ?? ""}`;
  return createHmac("sha256", secretKey).update(payload, "utf8").digest("hex");
}

export function encodeExternalUserId(externalUserId: string): string {
  return encodeURIComponent(externalUserId);
}

function reviewStatusOf(value: unknown): ProviderReviewStatus | null {
  return typeof value === "string" &&
    REVIEW_STATUSES.includes(value as ProviderReviewStatus)
    ? (value as ProviderReviewStatus)
    : null;
}

function reviewAnswerOf(value: unknown): "GREEN" | "RED" | null {
  return value === "GREEN" || value === "RED" ? value : null;
}

function rejectTypeOf(value: unknown): "FINAL" | "RETRY" | null {
  return value === "FINAL" || value === "RETRY" ? value : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {};
}

export function normalizeReviewStatus(payload: unknown): ReviewStatusRecord {
  const body = asObject(payload);
  const result = asObject(body.reviewResult);
  return {
    levelName: stringOrNull(body.levelName),
    reviewStatus: reviewStatusOf(body.reviewStatus),
    reviewAnswer: reviewAnswerOf(result.reviewAnswer),
    rejectType: rejectTypeOf(result.reviewRejectType),
    rejectLabels: stringsOf(result.rejectLabels),
    moderationComment: stringOrNull(result.moderationComment),
  };
}

export function normalizeApplicant(payload: unknown): ApplicantRecord {
  const body = asObject(payload);
  const id = stringOrNull(body.id);
  if (!id) throw new VerificationProviderError("malformed");
  const review = normalizeReviewStatus(body.review);
  const companyInfo = asObject(asObject(body.info).companyInfo);
  const beneficiaries = Array.isArray(companyInfo.beneficiaries)
    ? companyInfo.beneficiaries
    : [];
  const associatedPersonIds = beneficiaries.flatMap((entry) => {
    const person = asObject(entry);
    const applicantId = stringOrNull(person.applicantId);
    if (!applicantId) return [];
    const positions = stringsOf(person.positions);
    const types = stringsOf(person.types);
    const role = positions[0] ?? types[0] ?? stringOrNull(person.type) ?? "";
    return [{ applicantId, role }];
  });
  return {
    id,
    externalUserId: stringOrNull(body.externalUserId),
    type: body.type === "company" ? "company" : "individual",
    createdAt: stringOrNull(body.createdAt),
    sandboxMode:
      typeof body.sandboxMode === "boolean" ? body.sandboxMode : null,
    levelName:
      review.levelName ?? stringOrNull(asObject(body.review).levelName),
    reviewStatus: review.reviewStatus,
    reviewAnswer: review.reviewAnswer,
    rejectType: review.rejectType,
    rejectLabels: review.rejectLabels,
    moderationComment: review.moderationComment,
    associatedPersonIds,
  };
}

export function normalizeRequiredEvidence(payload: unknown): RequiredEvidence {
  const body = asObject(payload);
  const keys = Object.keys(body);
  if (keys.length === 0) return { complete: false, pending: ["unknown"] };
  const pending = keys.filter((key) => {
    const step = asObject(body[key]);
    const answer = reviewAnswerOf(asObject(step.reviewResult).reviewAnswer);
    return answer !== "GREEN";
  });
  return { complete: pending.length === 0, pending };
}

function classify(status: number): VerificationProviderError {
  if (status === 401 || status === 403) {
    return new VerificationProviderError("denied", 0, status);
  }
  if (status === 404) return new VerificationProviderError("not_found", 0, 404);
  if (status === 429) {
    return new VerificationProviderError("throttled", 60_000, 429);
  }
  if (status >= 500) {
    return new VerificationProviderError("upstream", 30_000, status);
  }
  return new VerificationProviderError("malformed", 0, status);
}

export function createSumsubClient(options: SumsubClientOptions): SumsubClient {
  const origin = (options.origin ?? SUMSUB_API_ORIGIN).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // The applicant API omits sandboxMode (only webhooks carry it), but app
  // tokens are environment-scoped, so the token prefix is authoritative.
  const tokenSandbox = options.appToken.startsWith("sbx:")
    ? true
    : options.appToken.startsWith("prd:")
      ? false
      : null;

  async function attempt(
    method: "GET" | "POST",
    pathWithQuery: string,
    body: string | undefined,
  ): Promise<unknown> {
    const ts = Math.floor(now() / 1000);
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-app-token": options.appToken,
      "x-app-access-ts": String(ts),
      "x-app-access-sig": signRequest(
        options.secretKey,
        ts,
        method,
        pathWithQuery,
        body,
      ),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${pathWithQuery}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      throw new VerificationProviderError(
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "transport",
      );
    }
    if (!response.ok) throw classify(response.status);
    try {
      return await response.json();
    } catch {
      throw new VerificationProviderError("malformed", 0, response.status);
    }
  }

  async function get(pathWithQuery: string): Promise<unknown> {
    let lastError: unknown;
    for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
      try {
        return await attempt("GET", pathWithQuery, undefined);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof VerificationProviderError &&
          error.retryable &&
          error.code !== "ambiguous";
        if (!retryable || index === RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[index]);
      }
    }
    throw lastError;
  }

  async function post(pathWithQuery: string, payload: Json): Promise<unknown> {
    return attempt("POST", pathWithQuery, JSON.stringify(payload));
  }

  async function getApplicantByExternalId(externalUserId: string) {
    try {
      const payload = await get(
        `/resources/applicants/-;externalUserId=${encodeExternalUserId(externalUserId)}/one`,
      );
      return normalizeApplicant(payload);
    } catch (error) {
      if (
        error instanceof VerificationProviderError &&
        error.code === "not_found"
      ) {
        return null;
      }
      throw error;
    }
  }

  async function getApplicant(applicantId: string) {
    return normalizeApplicant(
      await get(`/resources/applicants/${encodeURIComponent(applicantId)}/one`),
    );
  }

  async function getApplicantStatus(applicantId: string) {
    return normalizeReviewStatus(
      await get(
        `/resources/applicants/${encodeURIComponent(applicantId)}/status`,
      ),
    );
  }

  async function getRequiredEvidence(applicantId: string) {
    return normalizeRequiredEvidence(
      await get(
        `/resources/applicants/${encodeURIComponent(applicantId)}/requiredIdDocsStatus`,
      ),
    );
  }

  return {
    getApplicantByExternalId,
    getApplicant,
    getApplicantStatus,
    getRequiredEvidence,
    async ensureApplicant({ externalUserId, type, levelName }) {
      const existing = await getApplicantByExternalId(externalUserId);
      if (existing) return { applicantId: existing.id, created: false };
      try {
        const created = normalizeApplicant(
          await post(
            `/resources/applicants?levelName=${encodeURIComponent(levelName)}`,
            { externalUserId, type },
          ),
        );
        return { applicantId: created.id, created: true };
      } catch (error) {
        if (
          error instanceof VerificationProviderError &&
          (error.retryable || error.status === 409)
        ) {
          const reconciled = await getApplicantByExternalId(externalUserId);
          if (reconciled) return { applicantId: reconciled.id, created: true };
          throw new VerificationProviderError("ambiguous");
        }
        throw error;
      }
    },
    async createSdkToken({ externalUserId, levelName, ttlInSecs }) {
      const ttl = ttlInSecs ?? SDK_TOKEN_TTL_SECONDS;
      const payload = asObject(
        await post("/resources/accessTokens/sdk", {
          userId: externalUserId,
          levelName,
          ttlInSecs: ttl,
        }),
      );
      const token = stringOrNull(payload.token);
      if (!token) throw new VerificationProviderError("malformed");
      return { token, ttlInSecs: ttl };
    },
    async snapshot(applicantId) {
      const applicant = await getApplicant(applicantId);
      const status = await getApplicantStatus(applicantId);
      const evidence = await getRequiredEvidence(applicantId);
      const associatedPersons = [];
      for (const person of applicant.associatedPersonIds) {
        const personStatus = await getApplicantStatus(person.applicantId);
        associatedPersons.push({
          applicantId: person.applicantId,
          role: person.role,
          reviewStatus: personStatus.reviewStatus,
          reviewAnswer: personStatus.reviewAnswer,
        });
      }
      return {
        applicantType: applicant.type,
        levelName: status.levelName ?? applicant.levelName,
        sandboxMode: applicant.sandboxMode ?? tokenSandbox,
        reviewStatus: status.reviewStatus ?? applicant.reviewStatus,
        reviewAnswer: status.reviewAnswer ?? applicant.reviewAnswer,
        rejectType: status.rejectType ?? applicant.rejectType,
        rejectLabels: status.rejectLabels.length
          ? status.rejectLabels
          : applicant.rejectLabels,
        moderationComment:
          status.moderationComment ?? applicant.moderationComment,
        evidenceComplete: evidence.complete,
        pendingEvidence: evidence.pending,
        associatedPersons,
        applicantCreatedAt: applicant.createdAt,
        checkedAt: new Date(now()),
      };
    },
  };
}

export function configuredSumsubClient(
  config = verificationConfig(),
): SumsubClient {
  if (!config.appToken || !config.secretKey) {
    throw new VerificationConfigError("Sumsub API credentials are missing.");
  }
  return createSumsubClient({
    appToken: config.appToken,
    secretKey: config.secretKey,
    timeoutMs: config.timeoutMs,
  });
}
