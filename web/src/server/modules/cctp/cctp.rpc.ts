import "server-only";
import { z } from "zod";
import { getServerEnv } from "../../../env.server";
import { EVM_SOURCES } from "../../../lib/cctp";
import { sourceDomainSchema } from "./cctp.config";
import { CctpOperationalError } from "./cctp.errors";
import { boundedJson, isSolanaSignature } from "./iris.client";
import { coordination, digest, sharedBudget } from "./cctp.storage";

const defaults: Record<number, string> = {
  0: "https://ethereum-sepolia-rpc.publicnode.com", 1: "https://api.avax-test.network/ext/bc/C/rpc",
  3: "https://sepolia-rollup.arbitrum.io/rpc", 6: "https://sepolia.base.org", 5: "https://api.devnet.solana.com",
};
// Full base58 genesis hash of Solana devnet (`solana genesis-hash -u devnet`).
const SOLANA_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const endpointSchema = z.string().url().refine(s => { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password && !u.hash; });
const endpointsSchema = z.record(z.string().regex(/^(0|1|3|5|6)$/), z.array(endpointSchema).min(1).max(3));
function endpoints(domain: number): string[] {
  sourceDomainSchema.parse(domain);
  const raw = getServerEnv().CCTP_SOURCE_RPC_URLS;
  const configured = raw ? endpointsSchema.parse(JSON.parse(raw)) : {};
  return configured[String(domain)] ?? [defaults[domain]];
}
const hexHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const blockTag = z.string().regex(/^(latest|finalized|safe|0x[0-9a-fA-F]{1,16})$/);
const publicMethods = new Set(["eth_chainId", "eth_blockNumber", "eth_call", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "getLatestBlockhash", "getBlockHeight", "getSignatureStatuses", "sendTransaction", "getBalance", "getAccountInfo", "getGenesisHash", "getSlot", "getVersion"]);
export const rpcRequestSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().max(80), z.number().int()]), method: z.string().max(64), params: z.array(z.unknown()).max(4).default([]) }).strict();
export function validateRpcRequest(domain: number, raw: unknown) {
  sourceDomainSchema.parse(domain);
  const input = rpcRequestSchema.parse(raw);
  if (!publicMethods.has(input.method) || (domain === 5) === input.method.startsWith("eth_")) throw new CctpOperationalError("unsupported");
  const p = input.params;
  switch (input.method) {
    case "eth_chainId": case "eth_blockNumber": case "getGenesisHash": case "getVersion": z.tuple([]).parse(p); break;
    case "eth_getTransactionReceipt": case "eth_getTransactionByHash": z.tuple([hexHash]).parse(p); break;
    case "eth_getBlockByNumber": z.tuple([blockTag, z.literal(false)]).parse(p); break;
    case "eth_call": {
      const args = z.tuple([z.object({ to: z.string(), data: z.string() }).strict(), blockTag]).parse(p);
      if (args[0].to.toLowerCase() !== EVM_SOURCES[domain]?.usdc.toLowerCase() || !/^0x(dd62ed3e[0-9a-fA-F]{128}|70a08231[0-9a-fA-F]{64})$/.test(args[0].data)) throw new CctpOperationalError("unsupported");
      break;
    }
    case "sendTransaction": z.tuple([z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(1800), z.object({ encoding: z.literal("base64"), skipPreflight: z.literal(false).optional(), preflightCommitment: z.enum(["confirmed", "finalized"]).optional(), maxRetries: z.number().int().min(0).max(3).optional() }).strict()]).parse(p); break;
    case "getSignatureStatuses": z.tuple([z.array(z.string().refine(isSolanaSignature)).min(1).max(10), z.object({ searchTransactionHistory: z.boolean() }).strict().optional()]).parse(p); break;
    case "getBalance": case "getAccountInfo": z.tuple([z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), z.object({ commitment: z.enum(["confirmed", "finalized"]).optional(), encoding: z.literal("base64").optional() }).strict().optional()]).parse(p); break;
    default: z.tuple([z.object({ commitment: z.enum(["confirmed", "finalized"]).optional() }).strict().optional()]).parse(p);
  }
  return input;
}

async function upstream(url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!response.ok) { await response.body?.cancel(); throw new CctpOperationalError("transport"); }
    const envelope = z.object({ jsonrpc: z.literal("2.0"), id: z.literal(1), result: z.unknown().optional(), error: z.unknown().optional() }).parse(await boundedJson(response));
    if (envelope.error || !("result" in envelope)) throw new CctpOperationalError("upstream");
    return envelope.result;
  } catch (error) { throw error instanceof CctpOperationalError ? error : new CctpOperationalError(controller.signal.aborted ? "timeout" : "transport"); }
  finally { clearTimeout(timer); }
}
async function verifyEndpoint(domain: number, endpoint: string) {
  const rows = await coordination();
  const key = `rpc:network:${domain}:${digest(endpoint)}`;
  if (await rows.findOne({ _id: key, expiresAt: { $gt: new Date() } })) return;
  const identity = await upstream(endpoint, domain === 5 ? "getGenesisHash" : "eth_chainId", []);
  if (identity !== (domain === 5 ? SOLANA_DEVNET_GENESIS_HASH : `0x${EVM_SOURCES[domain].chainId.toString(16)}`)) throw new CctpOperationalError("configuration");
  await rows.updateOne({ _id: key }, { $set: { expiresAt: new Date(Date.now() + 60_000) } }, { upsert: true });
}
export async function checkSourceNetwork(domain: number) {
  let last: unknown;
  for (const endpoint of endpoints(domain)) { try { await verifyEndpoint(domain, endpoint); return; } catch (error) { last = error; } }
  throw last;
}
// Internal callers are trusted; the browser entry point must validateRpcRequest first.
export async function sourceRpc(domain: number, method: string, params: unknown[] = []): Promise<unknown> {
  let last: unknown;
  for (const endpoint of endpoints(domain)) {
    try {
      await sharedBudget(`rpc:${domain}`, 20, 1000);
      await verifyEndpoint(domain, endpoint);
      return await upstream(endpoint, method, params);
    } catch (error) { last = error; }
  }
  throw last;
}
