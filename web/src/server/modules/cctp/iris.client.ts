import "server-only";
import { z } from "zod";
import { getServerEnv } from "../../../env.server";
import { parseCctpMessage } from "../../../lib/cctpMessage";
import { CctpOperationalError } from "./cctp.errors";
import { assertCctpTestnet, sourceDomainSchema } from "./cctp.config";
import { claimLock, coordination, digest, sharedBudget } from "./cctp.storage";

const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(8194);
export const irisMessagesSchema = z.object({ messages: z.array(z.object({
  status: z.enum(["complete", "pending_confirmations", "pending_attestation", "pending"]),
  message: z.union([hex, z.literal(""), z.null()]).optional(),
  attestation: z.union([hex, z.literal("PENDING"), z.literal(""), z.null()]).optional(),
  eventNonce: z.string().max(128).optional(),
}).refine(v => v.status !== "complete" || (hex.safeParse(v.message).success && hex.safeParse(v.attestation).success))).max(100) });
export type IrisMessage = z.infer<typeof irisMessagesSchema>["messages"][number];
export const irisFeesSchema = z.array(z.object({ finalityThreshold: z.number().int(), minimumFee: z.number().finite().nonnegative() })).min(1).max(10);

export function isSolanaSignature(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let decoded = 0n;
  for (const char of value) decoded = decoded * 58n + BigInt(alphabet.indexOf(char));
  let size = 0;
  while (decoded > 0n) { size++; decoded >>= 8n; }
  return size + (value.match(/^1*/)?.[0].length ?? 0) === 64;
}

export function normalizeSourceIdentifier(domain: number, identifier: string) {
  sourceDomainSchema.parse(domain);
  if (domain === 5) {
    if (!isSolanaSignature(identifier)) throw new CctpOperationalError("binding");
    return identifier;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(identifier)) throw new CctpOperationalError("binding");
  return identifier.toLowerCase();
}

export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 30_000;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(1000, Math.min(86_400_000, milliseconds)) : 30_000;
}

export async function boundedJson(response: Response, maxBytes = 1_048_576): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) throw new CctpOperationalError("malformed");
  if (!response.body) throw new CctpOperationalError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new CctpOperationalError("malformed");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof CctpOperationalError) throw error;
    throw new CctpOperationalError("malformed");
  } finally { await reader.cancel().catch(() => {}); }
}

// Only these two fixed paths are reachable; redirects never forward credentials.
async function request<T>(domain: number, path: string, schema: z.ZodType<T>, pending404: boolean, cacheMs: number): Promise<T | null> {
  sourceDomainSchema.parse(domain);
  assertCctpTestnet();
  const config = getServerEnv();
  if (config.CIRCLE_IRIS_URL.replace(/\/$/, "") !== "https://iris-api-sandbox.circle.com") throw new CctpOperationalError("configuration");
  const rows = await coordination();
  const circuitKey = `iris:circuit:${domain}`;
  const cacheKey = `iris:cache:${digest(path)}`;
  const cached = await rows.findOne({ _id: cacheKey, expiresAt: { $gt: new Date() } });
  if (cached?.value) return JSON.parse(cached.value) as T | null;
  const circuit = await rows.findOne({ _id: circuitKey });
  if (circuit?.nextAt && circuit.nextAt.getTime() > Date.now()) throw new CctpOperationalError(circuit.denied ? "denied" : "throttled", circuit.nextAt.getTime() - Date.now());
  const lock = await claimLock(`iris:request:${digest(path)}`, 45_000);
  if (!lock) throw new CctpOperationalError("pending", 5000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.CCTP_IRIS_TIMEOUT_MS);
  const started = Date.now();
  let outcome = "complete";
  try {
    await sharedBudget("iris", config.CCTP_IRIS_RPS, 1000);
    const response = await fetch(`https://iris-api-sandbox.circle.com${path}`, {
      signal: controller.signal, redirect: "error", cache: "no-store",
      headers: config.CIRCLE_API_KEY ? { Authorization: `Bearer ${config.CIRCLE_API_KEY}` } : {},
    });
    let data: T | null;
    if (pending404 && response.status === 404) { data = null; await response.body?.cancel(); }
    else {
      if (!response.ok) {
        await response.body?.cancel();
        throw new CctpOperationalError(response.status === 429 ? "throttled" : [403, 451].includes(response.status) ? "denied" : "upstream", retryAfter(response.headers.get("retry-after")));
      }
      const parsed = schema.safeParse(await boundedJson(response));
      if (!parsed.success) throw new CctpOperationalError("malformed");
      data = parsed.data;
    }
    await rows.updateOne({ _id: cacheKey }, { $set: { value: JSON.stringify(data), expiresAt: new Date(Date.now() + cacheMs) } }, { upsert: true });
    await rows.updateOne({ _id: circuitKey }, { $set: { failures: 0, nextAt: new Date(0) } }, { upsert: true });
    return data;
  } catch (error) {
    const fault = controller.signal.aborted ? new CctpOperationalError("timeout") : error instanceof CctpOperationalError ? error : new CctpOperationalError("transport");
    outcome = fault.code;
    const failures = (circuit?.failures ?? 0) + 1;
    const delay = Math.max(fault.retryAfterMs, Math.min(300_000, 1000 * 2 ** Math.min(failures, 8)) * (0.75 + Math.random() * 0.5));
    await rows.updateOne({ _id: circuitKey }, { $set: { failures, ...(fault.code === "denied" ? { denied: true } : {}), nextAt: new Date(Date.now() + delay) } }, { upsert: true });
    throw fault;
  } finally {
    clearTimeout(timeout);
    await lock.release();
    console.info("[cctp-iris]", JSON.stringify({ domain, outcome, latencyMs: Date.now() - started }));
  }
}

export async function fetchIrisMessages(domain: number, txHash: string): Promise<IrisMessage[]> {
  const hash = normalizeSourceIdentifier(domain, txHash);
  const data = await request(domain, `/v2/messages/${domain}?transactionHash=${encodeURIComponent(hash)}`, irisMessagesSchema, true, 5000);
  const messages = data?.messages ?? [];
  for (const candidate of messages) {
    if (candidate.message) {
      let parsed;
      try { parsed = parseCctpMessage(candidate.message); } catch { throw new CctpOperationalError("malformed"); }
      if (parsed.sourceDomain !== domain) throw new CctpOperationalError("malformed");
    }
  }
  return messages;
}

export async function standardFee(domain: number): Promise<number> {
  const fees = await request(domain, `/v2/burn/USDC/fees/${domain}/27`, irisFeesSchema, false, 15_000);
  const standard = fees?.filter(f => f.finalityThreshold === 2000);
  if (standard?.length !== 1) throw new CctpOperationalError("unsupported");
  return standard[0].minimumFee;
}

export function selectIrisMessage(messages: IrisMessage[], matches: (message: string) => boolean): IrisMessage | null {
  const selected = messages.filter(m => m.message && matches(m.message));
  if (selected.length > 1) throw new CctpOperationalError("binding");
  return selected[0]?.status === "complete" ? selected[0] : null;
}
