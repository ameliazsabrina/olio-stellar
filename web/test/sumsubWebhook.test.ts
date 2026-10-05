// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insertOne: vi.fn() }));
vi.mock("../src/server/db/mongo", () => ({
  getVerificationEvents: async () => ({ insertOne: mocks.insertOne }),
}));

import {
  computeDigest,
  eventKey,
  handleWebhook,
  MAX_WEBHOOK_BYTES,
  parseWebhook,
  verifyDigest,
} from "../src/server/modules/verification/sumsub.webhook";
import type { VerificationConfig } from "../src/server/modules/verification/verification.config";

const SECRET = "webhook-secret";

const baseConfig: VerificationConfig = {
  mode: "sandbox",
  environment: "sandbox",
  appToken: "sbx:token",
  secretKey: "secret",
  webhookSecret: SECRET,
  webhookAlgorithm: "HMAC_SHA256_HEX",
  levels: { individual: "olio-individual", company: "olio-company" },
  expectedClientId: "olio",
  timeoutMs: 15_000,
  policyVersion: 1,
  workerEnabled: true,
  operatorIds: [],
  productionRuntime: false,
};

const payload = {
  applicantId: "app_1",
  inspectionId: "insp_1",
  applicantType: "individual",
  correlationId: "corr_1",
  levelName: "olio-individual",
  externalUserId: "olio-sandbox-abc",
  type: "applicantReviewed",
  sandboxMode: true,
  reviewStatus: "completed",
  reviewResult: { reviewAnswer: "GREEN" },
  createdAtMs: "2026-09-21 08:04:23.379",
  clientId: "olio",
};

function body(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({ ...payload, ...overrides }), "utf8");
}

function headers(raw: Buffer, algorithm = "HMAC_SHA256_HEX", secret = SECRET) {
  return {
    algorithm,
    digest: computeDigest(
      algorithm as "HMAC_SHA256_HEX" | "HMAC_SHA512_HEX",
      secret,
      raw,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertOne.mockResolvedValue({ acknowledged: true });
});

describe("digest verification", () => {
  it("accepts a digest computed over the exact raw bytes", () => {
    const raw = body();
    expect(
      verifyDigest({
        raw,
        secret: SECRET,
        algorithmHeader: "HMAC_SHA256_HEX",
        digestHeader: headers(raw).digest,
        allowedAlgorithm: "HMAC_SHA256_HEX",
      }),
    ).toBe("ok");
  });

  it("matches the documented HMAC-SHA256 hex construction", () => {
    const raw = body();
    expect(computeDigest("HMAC_SHA256_HEX", SECRET, raw)).toBe(
      createHmac("sha256", SECRET).update(raw).digest("hex"),
    );
    expect(computeDigest("HMAC_SHA512_HEX", SECRET, raw)).toBe(
      createHmac("sha512", SECRET).update(raw).digest("hex"),
    );
  });

  it("rejects a body altered after signing, even by whitespace", () => {
    const raw = body();
    const digest = computeDigest("HMAC_SHA256_HEX", SECRET, raw);
    const altered = Buffer.from(`${raw.toString("utf8")} `, "utf8");
    expect(
      verifyDigest({
        raw: altered,
        secret: SECRET,
        algorithmHeader: "HMAC_SHA256_HEX",
        digestHeader: digest,
        allowedAlgorithm: "HMAC_SHA256_HEX",
      }),
    ).toBe("invalid_signature");
  });

  it("rejects a digest made with a different secret", () => {
    const raw = body();
    expect(
      verifyDigest({
        raw,
        secret: SECRET,
        algorithmHeader: "HMAC_SHA256_HEX",
        digestHeader: computeDigest("HMAC_SHA256_HEX", "other", raw),
        allowedAlgorithm: "HMAC_SHA256_HEX",
      }),
    ).toBe("invalid_signature");
  });

  it("rejects the deprecated SHA1 algorithm and any unknown algorithm", () => {
    const raw = body();
    for (const algorithm of ["HMAC_SHA1_HEX", "NONE", "hmac_sha256_hex"]) {
      expect(
        verifyDigest({
          raw,
          secret: SECRET,
          algorithmHeader: algorithm,
          digestHeader: createHmac("sha1", SECRET).update(raw).digest("hex"),
          allowedAlgorithm: "HMAC_SHA256_HEX",
        }),
      ).toBe("unsupported_algorithm");
    }
  });

  it("rejects a missing digest or algorithm header", () => {
    const raw = body();
    expect(
      verifyDigest({
        raw,
        secret: SECRET,
        algorithmHeader: null,
        digestHeader: "abc",
        allowedAlgorithm: "HMAC_SHA256_HEX",
      }),
    ).toBe("unsigned");
    expect(
      verifyDigest({
        raw,
        secret: SECRET,
        algorithmHeader: "HMAC_SHA256_HEX",
        digestHeader: null,
        allowedAlgorithm: "HMAC_SHA256_HEX",
      }),
    ).toBe("unsigned");
  });

  it("rejects a malformed non-hex digest without throwing", () => {
    const raw = body();
    expect(
      verifyDigest({
        raw,
        secret: SECRET,
        algorithmHeader: "HMAC_SHA256_HEX",
        digestHeader: "not-hex!!",
        allowedAlgorithm: "HMAC_SHA256_HEX",
      }),
    ).toBe("invalid_signature");
  });

  it("honours a deployment configured for SHA512 only", () => {
    const raw = body();
    expect(
      verifyDigest({
        raw,
        secret: SECRET,
        algorithmHeader: "HMAC_SHA256_HEX",
        digestHeader: computeDigest("HMAC_SHA256_HEX", SECRET, raw),
        allowedAlgorithm: "HMAC_SHA512_HEX",
      }),
    ).toBe("unsupported_algorithm");
  });
});

describe("payload parsing", () => {
  it("keeps the routing fields and ignores unknown extras", () => {
    const parsed = parseWebhook(body({ extraField: "ignored" }));
    expect(parsed?.type).toBe("applicantReviewed");
    expect(parsed?.externalUserId).toBe("olio-sandbox-abc");
    expect(parsed?.reviewResult?.reviewAnswer).toBe("GREEN");
  });

  it("returns null for non-JSON and oversized bodies", () => {
    expect(parseWebhook(Buffer.from("not json", "utf8"))).toBeNull();
    expect(parseWebhook(Buffer.alloc(MAX_WEBHOOK_BYTES + 1, 0x20))).toBeNull();
  });

  it("derives a deterministic per-environment event key", () => {
    const raw = body();
    expect(eventKey("sandbox", raw)).toBe(eventKey("sandbox", raw));
    expect(eventKey("sandbox", raw)).not.toBe(eventKey("live", raw));
  });
});

describe("webhook intake", () => {
  it("persists one durable job for an authenticated notification", async () => {
    const raw = body();
    const result = await handleWebhook(raw, headers(raw), baseConfig);
    expect(result).toEqual({
      outcome: "queued",
      eventId: eventKey("sandbox", raw),
    });
    const [doc] = mocks.insertOne.mock.calls[0];
    expect(doc).toMatchObject({
      provider: "sumsub",
      environment: "sandbox",
      externalUserId: "olio-sandbox-abc",
      applicantId: "app_1",
      type: "applicantReviewed",
      reviewStatus: "completed",
      reviewAnswer: "GREEN",
      state: "queued",
      attempts: 0,
    });
    expect(doc).not.toHaveProperty("reviewResult");
  });

  it("reports a replay as a duplicate instead of queueing twice", async () => {
    mocks.insertOne.mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: 11000 }),
    );
    const raw = body();
    expect(await handleWebhook(raw, headers(raw), baseConfig)).toEqual({
      outcome: "duplicate",
      eventId: eventKey("sandbox", raw),
    });
  });

  it("propagates a storage failure so the provider retries instead of losing the event", async () => {
    mocks.insertOne.mockRejectedValueOnce(new Error("mongo down"));
    const raw = body();
    await expect(handleWebhook(raw, headers(raw), baseConfig)).rejects.toThrow(
      "mongo down",
    );
  });

  it("never stores an unauthenticated notification", async () => {
    const raw = body();
    expect(
      await handleWebhook(
        raw,
        { algorithm: "HMAC_SHA256_HEX", digest: "00" },
        baseConfig,
      ),
    ).toEqual({ outcome: "ignored", reason: "invalid_signature" });
    expect(mocks.insertOne).not.toHaveBeenCalled();
  });

  it("keeps a live notification out of a sandbox deployment", async () => {
    const raw = body({ sandboxMode: false });
    expect(await handleWebhook(raw, headers(raw), baseConfig)).toEqual({
      outcome: "ignored",
      reason: "environment_mismatch",
    });
    expect(mocks.insertOne).not.toHaveBeenCalled();
  });

  it("keeps a sandbox notification out of a live deployment", async () => {
    const raw = body({ sandboxMode: true });
    const liveConfig = {
      ...baseConfig,
      mode: "live" as const,
      environment: "live" as const,
    };
    expect(await handleWebhook(raw, headers(raw), liveConfig)).toEqual({
      outcome: "ignored",
      reason: "environment_mismatch",
    });
  });

  it("ignores a test notification", async () => {
    const raw = body({ testMode: true });
    expect(await handleWebhook(raw, headers(raw), baseConfig)).toEqual({
      outcome: "ignored",
      reason: "test_notification",
    });
    expect(mocks.insertOne).not.toHaveBeenCalled();
  });

  it("ignores a notification addressed to a different client", async () => {
    const raw = body({ clientId: "someone-else" });
    expect(await handleWebhook(raw, headers(raw), baseConfig)).toEqual({
      outcome: "ignored",
      reason: "client_mismatch",
    });
  });

  it("accepts a payload without a clientId when none is expected", async () => {
    const raw = body({ clientId: undefined });
    const result = await handleWebhook(raw, headers(raw), {
      ...baseConfig,
      expectedClientId: null,
    });
    expect(result.outcome).toBe("queued");
  });

  it("refuses to process anything while verification is disabled", async () => {
    const raw = body();
    expect(
      await handleWebhook(raw, headers(raw), {
        ...baseConfig,
        mode: "off",
        environment: null,
      }),
    ).toEqual({ outcome: "ignored", reason: "disabled" });
    expect(mocks.insertOne).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before parsing it", async () => {
    const raw = Buffer.alloc(MAX_WEBHOOK_BYTES + 10, 0x20);
    expect(await handleWebhook(raw, headers(raw), baseConfig)).toEqual({
      outcome: "ignored",
      reason: "too_large",
    });
  });
});
