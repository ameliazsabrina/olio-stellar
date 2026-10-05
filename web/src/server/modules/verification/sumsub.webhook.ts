import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getVerificationEvents } from "../../db/mongo";
import {
  type VerificationConfig,
  verificationConfig,
} from "./verification.config";
import { type WebhookPayload, webhookPayload } from "./verification.schema";
import { digest } from "./verification.storage";

export const MAX_WEBHOOK_BYTES = 65_536;

export type WebhookAlgorithm = "HMAC_SHA256_HEX" | "HMAC_SHA512_HEX";

export type WebhookResult =
  | {
      outcome: "ignored";
      reason:
        | "disabled"
        | "too_large"
        | "unsigned"
        | "unsupported_algorithm"
        | "invalid_signature"
        | "malformed"
        | "client_mismatch"
        | "environment_mismatch"
        | "test_notification";
    }
  | { outcome: "duplicate"; eventId: string }
  | { outcome: "queued"; eventId: string };

export function computeDigest(
  algorithm: WebhookAlgorithm,
  secret: string,
  raw: Buffer,
): string {
  const hash = algorithm === "HMAC_SHA512_HEX" ? "sha512" : "sha256";
  return createHmac(hash, secret).update(raw).digest("hex");
}

export function verifyDigest(input: {
  raw: Buffer;
  secret: string;
  algorithmHeader: string | null;
  digestHeader: string | null;
  allowedAlgorithm: WebhookAlgorithm;
}): "ok" | "unsigned" | "unsupported_algorithm" | "invalid_signature" {
  if (!input.digestHeader || !input.algorithmHeader) return "unsigned";
  if (input.algorithmHeader !== input.allowedAlgorithm) {
    return "unsupported_algorithm";
  }
  const expected = computeDigest(
    input.allowedAlgorithm,
    input.secret,
    input.raw,
  );
  const presented = input.digestHeader.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(presented)) return "invalid_signature";
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(presented, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return "invalid_signature";
  }
  return "ok";
}

export function parseWebhook(raw: Buffer): WebhookPayload | null {
  if (raw.length > MAX_WEBHOOK_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = webhookPayload.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export function eventKey(environment: string, raw: Buffer): string {
  return `sumsub:${environment}:${digest(raw.toString("utf8"))}`;
}

export type WebhookHeaders = {
  algorithm: string | null;
  digest: string | null;
};

export async function handleWebhook(
  raw: Buffer,
  headers: WebhookHeaders,
  config: VerificationConfig = verificationConfig(),
  now = new Date(),
): Promise<WebhookResult> {
  if (!config.environment || !config.webhookSecret) {
    return { outcome: "ignored", reason: "disabled" };
  }
  if (raw.length > MAX_WEBHOOK_BYTES) {
    return { outcome: "ignored", reason: "too_large" };
  }
  const verdict = verifyDigest({
    raw,
    secret: config.webhookSecret,
    algorithmHeader: headers.algorithm,
    digestHeader: headers.digest,
    allowedAlgorithm: config.webhookAlgorithm,
  });
  if (verdict !== "ok") return { outcome: "ignored", reason: verdict };

  const payload = parseWebhook(raw);
  if (!payload) return { outcome: "ignored", reason: "malformed" };
  if (
    config.expectedClientId &&
    payload.clientId !== undefined &&
    payload.clientId !== config.expectedClientId
  ) {
    return { outcome: "ignored", reason: "client_mismatch" };
  }
  if (payload.testMode === true) {
    return { outcome: "ignored", reason: "test_notification" };
  }
  const expectedSandbox = config.environment === "sandbox";
  if (
    payload.sandboxMode !== undefined &&
    payload.sandboxMode !== expectedSandbox
  ) {
    return { outcome: "ignored", reason: "environment_mismatch" };
  }

  const eventId = eventKey(config.environment, raw);
  try {
    await (await getVerificationEvents()).insertOne({
      _id: eventId,
      provider: "sumsub",
      environment: config.environment,
      externalUserId: payload.externalUserId ?? null,
      applicantId: payload.applicantId ?? null,
      type: payload.type,
      reviewStatus: payload.reviewStatus ?? null,
      reviewAnswer: payload.reviewResult?.reviewAnswer ?? null,
      providerCreatedAt: payload.createdAtMs ?? null,
      correlationId: payload.correlationId ?? null,
      state: "queued",
      attempts: 0,
      nextAttemptAt: now,
      receivedAt: now,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return { outcome: "duplicate", eventId };
    }
    throw error;
  }
  return { outcome: "queued", eventId };
}
