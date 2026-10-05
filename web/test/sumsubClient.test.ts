// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSumsubClient,
  encodeExternalUserId,
  normalizeApplicant,
  normalizeRequiredEvidence,
  normalizeReviewStatus,
  signRequest,
} from "../src/server/modules/verification/sumsub.client";
import { VerificationProviderError } from "../src/server/modules/verification/verification.errors";

const APP_TOKEN = "sbx:app-token";
const SECRET = "secret-key";

type Call = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(
  handler: (call: Call, index: number) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  const client = createSumsubClient({
    appToken: APP_TOKEN,
    secretKey: SECRET,
    fetchImpl,
    now: () => 1_700_000_000_000,
    sleep: async () => {},
  });
  return { client, calls, fetchImpl };
}

function headerOf(call: Call, name: string): string {
  return (call.init.headers as Record<string, string>)[name];
}

describe("Sumsub request signing", () => {
  it("signs ts + method + path-with-query + exact body bytes", () => {
    const body = JSON.stringify({ userId: "u", levelName: "l" });
    const expected = createHmac("sha256", SECRET)
      .update(`1607551635POST/resources/accessTokens/sdk${body}`, "utf8")
      .digest("hex");
    expect(
      signRequest(
        SECRET,
        1607551635,
        "POST",
        "/resources/accessTokens/sdk",
        body,
      ),
    ).toBe(expected);
  });

  it("omits the body for GET requests and uppercases the method", () => {
    const expected = createHmac("sha256", SECRET)
      .update("1607551635GET/resources/applicants/abc/status", "utf8")
      .digest("hex");
    expect(
      signRequest(
        SECRET,
        1607551635,
        "get",
        "/resources/applicants/abc/status",
        undefined,
      ),
    ).toBe(expected);
  });

  it("percent-encodes external user ids inside the applicant path", () => {
    expect(encodeExternalUserId("olio-sandbox-a/b;c")).toBe(
      "olio-sandbox-a%2Fb%3Bc",
    );
  });
});

describe("Sumsub client requests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the signature that matches the transmitted URL and body", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({ token: "tok", userId: "olio-sandbox-1" }),
    );
    await client.createSdkToken({
      externalUserId: "olio-sandbox-1",
      levelName: "olio-individual",
      ttlInSecs: 600,
    });
    const call = calls[0];
    expect(call.url).toBe("https://api.sumsub.com/resources/accessTokens/sdk");
    const ts = Number(headerOf(call, "x-app-access-ts"));
    expect(ts).toBe(1_700_000_000);
    expect(headerOf(call, "x-app-token")).toBe(APP_TOKEN);
    expect(headerOf(call, "x-app-access-sig")).toBe(
      signRequest(
        SECRET,
        ts,
        "POST",
        "/resources/accessTokens/sdk",
        call.init.body as string,
      ),
    );
    expect(JSON.parse(call.init.body as string)).toEqual({
      userId: "olio-sandbox-1",
      levelName: "olio-individual",
      ttlInSecs: 600,
    });
  });

  it("classifies a timeout as a retryable provider error", async () => {
    const { client } = clientWith(() => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    });
    const failure = await client
      .getApplicantStatus("app_1")
      .catch((error) => error);
    expect(failure).toBeInstanceOf(VerificationProviderError);
    expect(failure.code).toBe("timeout");
    expect(failure.retryable).toBe(true);
  });

  it("treats 401 as a non-retryable denial", async () => {
    const { client, fetchImpl } = clientWith(() => jsonResponse({}, 401));
    const failure = await client
      .getApplicantStatus("app_1")
      .catch((error) => error);
    expect(failure.code).toBe("denied");
    expect(failure.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null instead of throwing when no applicant maps to the external id", async () => {
    const { client } = clientWith(() => jsonResponse({}, 404));
    expect(
      await client.getApplicantByExternalId("olio-sandbox-missing"),
    ).toBeNull();
  });

  it("reuses the existing applicant instead of creating a duplicate", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({
        id: "app_existing",
        externalUserId: "olio-sandbox-1",
        type: "individual",
      }),
    );
    const result = await client.ensureApplicant({
      externalUserId: "olio-sandbox-1",
      type: "individual",
      levelName: "olio-individual",
    });
    expect(result).toEqual({ applicantId: "app_existing", created: false });
    expect(calls).toHaveLength(1);
  });

  it("reconciles by external id after an ambiguous creation instead of creating twice", async () => {
    let created = false;
    const { client, calls } = clientWith((call) => {
      if (call.url.includes("/one")) {
        return created
          ? jsonResponse({ id: "app_raced", type: "company" })
          : jsonResponse({}, 404);
      }
      created = true;
      return jsonResponse({}, 503);
    });
    const result = await client.ensureApplicant({
      externalUserId: "olio-sandbox-2",
      type: "company",
      levelName: "olio-company",
    });
    expect(result).toEqual({ applicantId: "app_raced", created: true });
    expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
  });

  it("surfaces an ambiguous error when creation fails and nothing is found", async () => {
    const { client } = clientWith((call) =>
      call.url.includes("/one") ? jsonResponse({}, 404) : jsonResponse({}, 502),
    );
    const failure = await client
      .ensureApplicant({
        externalUserId: "olio-sandbox-3",
        type: "individual",
        levelName: "olio-individual",
      })
      .catch((error) => error);
    expect(failure.code).toBe("ambiguous");
  });

  it("scopes the SDK token to the stored external id and level only", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ token: "tok" }));
    const token = await client.createSdkToken({
      externalUserId: "olio-sandbox-1",
      levelName: "olio-company",
    });
    expect(token).toEqual({ token: "tok", ttlInSecs: 600 });
    expect(Object.keys(JSON.parse(calls[0].init.body as string))).toEqual([
      "userId",
      "levelName",
      "ttlInSecs",
    ]);
  });

  it("rejects a token response without a token", async () => {
    const { client } = clientWith(() => jsonResponse({ userId: "u" }));
    await expect(
      client.createSdkToken({ externalUserId: "u", levelName: "l" }),
    ).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("Sumsub response normalization", () => {
  it("keeps only the review fields the policy consumes", () => {
    expect(
      normalizeReviewStatus({
        levelName: "olio-individual",
        reviewStatus: "completed",
        reviewResult: {
          reviewAnswer: "RED",
          reviewRejectType: "RETRY",
          rejectLabels: ["BAD_PROOF_OF_IDENTITY"],
          moderationComment: "Photo is blurry",
          clientComment: "internal only",
        },
      }),
    ).toEqual({
      levelName: "olio-individual",
      reviewStatus: "completed",
      reviewAnswer: "RED",
      rejectType: "RETRY",
      rejectLabels: ["BAD_PROOF_OF_IDENTITY"],
      moderationComment: "Photo is blurry",
    });
  });

  it("drops unknown review statuses rather than trusting them", () => {
    expect(
      normalizeReviewStatus({ reviewStatus: "totallyFine" }).reviewStatus,
    ).toBeNull();
  });

  it("extracts company beneficiaries with applicant ids", () => {
    const applicant = normalizeApplicant({
      id: "app_company",
      externalUserId: "olio-sandbox-9",
      type: "company",
      sandboxMode: true,
      review: { reviewStatus: "pending" },
      info: {
        companyInfo: {
          beneficiaries: [
            { applicantId: "app_owner", positions: ["director"] },
            { positions: ["shareholder"] },
          ],
        },
      },
    });
    expect(applicant.associatedPersonIds).toEqual([
      { applicantId: "app_owner", role: "director" },
    ]);
    expect(applicant.sandboxMode).toBe(true);
  });

  it("rejects an applicant payload without an id", () => {
    expect(() => normalizeApplicant({ externalUserId: "x" })).toThrow(
      VerificationProviderError,
    );
  });

  it("treats an empty required-documents map as incomplete", () => {
    expect(normalizeRequiredEvidence({})).toEqual({
      complete: false,
      pending: ["unknown"],
    });
  });

  it("lists every non-green document step as pending", () => {
    expect(
      normalizeRequiredEvidence({
        IDENTITY: { reviewResult: { reviewAnswer: "GREEN" } },
        SELFIE: { reviewResult: { reviewAnswer: "RED" } },
        PROOF_OF_RESIDENCE: {},
      }),
    ).toEqual({ complete: false, pending: ["SELFIE", "PROOF_OF_RESIDENCE"] });
  });
});

describe("Sumsub snapshot", () => {
  it("collects applicant, status, evidence and every associated person", async () => {
    const { client } = clientWith((call) => {
      if (call.url.endsWith("/resources/applicants/app_company/one")) {
        return jsonResponse({
          id: "app_company",
          type: "company",
          sandboxMode: true,
          createdAt: "2026-09-01 10:00:00",
          review: { reviewStatus: "completed" },
          info: {
            companyInfo: {
              beneficiaries: [
                { applicantId: "app_owner", positions: ["director"] },
              ],
            },
          },
        });
      }
      if (call.url.endsWith("/resources/applicants/app_company/status")) {
        return jsonResponse({
          levelName: "olio-company",
          reviewStatus: "completed",
          reviewResult: { reviewAnswer: "GREEN" },
        });
      }
      if (call.url.endsWith("/requiredIdDocsStatus")) {
        return jsonResponse({
          COMPANY_DOC: { reviewResult: { reviewAnswer: "GREEN" } },
        });
      }
      return jsonResponse({
        reviewStatus: "pending",
        reviewResult: {},
      });
    });
    const snapshot = await client.snapshot("app_company");
    expect(snapshot.applicantType).toBe("company");
    expect(snapshot.reviewAnswer).toBe("GREEN");
    expect(snapshot.evidenceComplete).toBe(true);
    expect(snapshot.associatedPersons).toEqual([
      {
        applicantId: "app_owner",
        role: "director",
        reviewStatus: "pending",
        reviewAnswer: null,
      },
    ]);
    expect(snapshot.sandboxMode).toBe(true);
  });
  it("derives sandboxMode from the token prefix when the applicant omits it", async () => {
    const respond = (call: Call) =>
      call.url.endsWith("/one")
        ? jsonResponse({ id: "app_1", type: "individual", review: {} })
        : call.url.endsWith("/status")
          ? jsonResponse({ reviewStatus: "completed", reviewResult: {} })
          : jsonResponse({});
    const { client } = clientWith(respond);
    expect((await client.snapshot("app_1")).sandboxMode).toBe(true);
    const live = createSumsubClient({
      appToken: "prd:app-token",
      secretKey: SECRET,
      fetchImpl: async (url, init) => respond({ url, init }),
      sleep: async () => {},
    });
    expect((await live.snapshot("app_1")).sandboxMode).toBe(false);
  });
});
