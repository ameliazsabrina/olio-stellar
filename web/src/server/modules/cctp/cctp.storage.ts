import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getServerEnv } from "../../../env.server";
import { getDb } from "../../db/mongo";
import { CctpOperationalError } from "./cctp.errors";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function encryptionKey() {
  const key = getServerEnv().CCTP_SESSION_KEY;
  if (!key) throw new CctpOperationalError("configuration");
  return Buffer.from(key, "hex");
}
export function seal(value: unknown, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
export function unseal(value: string, binding: string): unknown {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
}

type Coordination = { _id: string; owner?: string; until?: Date; nextAt?: Date; count?: number; expiresAt?: Date; value?: string; failures?: number; denied?: boolean };
export async function coordination() {
  return (await getDb()).collection<Coordination>("cctp_coordination");
}

// Deployment-wide fixed-window limits; deterministic _id also fences concurrent upserts.
export async function sharedBudget(key: string, limit: number, windowMs: number) {
  const bucket = Math.floor(Date.now() / windowMs);
  const row = await (await coordination()).findOneAndUpdate(
    { _id: `budget:${key}:${bucket}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } },
    { upsert: true, returnDocument: "after" },
  );
  if (!row || (row.count ?? 0) > limit) throw new CctpOperationalError("throttled", windowMs);
}

export async function claimLock(key: string, durationMs: number) {
  const rows = await coordination();
  const owner = randomUUID();
  const now = new Date();
  try {
    const row = await rows.findOneAndUpdate(
      { _id: key, $or: [{ until: { $lte: now } }, { until: { $exists: false } }] },
      { $set: { owner, until: new Date(Date.now() + durationMs) } },
      { upsert: true, returnDocument: "after", writeConcern: { w: "majority", j: true } },
    );
    if (!row || row.owner !== owner) return null;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  }
  return {
    async assert(remainingMs = 0) {
      if (!await rows.findOne({ _id: key, owner, until: { $gt: new Date(Date.now() + remainingMs) } })) throw new CctpOperationalError("lease_lost");
    },
    async heartbeat() {
      const result = await rows.updateOne({ _id: key, owner, until: { $gt: new Date() } }, { $set: { until: new Date(Date.now() + durationMs) } });
      if (result.matchedCount !== 1) throw new CctpOperationalError("lease_lost");
    },
    async release() { await rows.deleteOne({ _id: key, owner }); },
  };
}
