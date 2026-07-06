import { Buffer } from "buffer";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr
} from "@stellar/stellar-sdk";
import { isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { fromBaseUnits } from "./crypto";
import type { RawProof } from "./prover";

export const networkPassphrase =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
export const rpcUrl =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
export const registryId = process.env.NEXT_PUBLIC_OLIO_REGISTRY_ID || "";
export const poolId = process.env.NEXT_PUBLIC_OLIO_POOL_ID || "";
export const usdcSacId = process.env.NEXT_PUBLIC_USDC_SAC_ID || "";
export const usdcIssuer = process.env.NEXT_PUBLIC_USDC_ISSUER || "";

export const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

// --- ScVal builders ---------------------------------------------------------

const scAddr = (s: string) => new Address(s).toScVal();
const scStr = (s: string) => nativeToScVal(s, { type: "string" });
const scSym = (s: string) => nativeToScVal(s, { type: "symbol" });
const scBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));
const scI128 = (v: bigint) => nativeToScVal(v, { type: "i128" });

function scProof(proof: RawProof): xdr.ScVal {
  const entry = (k: string, v: Uint8Array) =>
    new xdr.ScMapEntry({ key: scSym(k), val: scBytes(v) });
  return xdr.ScVal.scvMap([entry("a", proof.a), entry("b", proof.b), entry("c", proof.c)]);
}

const toBytes = (v: unknown): Uint8Array =>
  v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);

// --- Freighter --------------------------------------------------------------

export async function connectWallet(): Promise<string> {
  const conn = await isConnected();
  if ("error" in conn && conn.error) throw new Error(String(conn.error));
  if (!conn.isConnected) throw new Error("Freighter is not installed or unavailable.");
  const access = await requestAccess();
  if (access.error) throw new Error(String(access.error));
  return access.address;
}

// --- read + write helpers ---------------------------------------------------

export async function simulateRead(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<unknown> {
  const source = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function invoke(
  publicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<unknown> {
  const account = await server.getAccount(publicKey);
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(built);
  return signSendPoll(prepared.toXDR(), publicKey);
}

async function signSendPoll(unsignedXdr: string, publicKey: string): Promise<unknown> {
  const signed = await signTransaction(unsignedXdr, { networkPassphrase, address: publicKey });
  if (signed.error) throw new Error(String(signed.error));
  const tx = TransactionBuilder.fromXDR(signed.signedTxXdr, networkPassphrase);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error("Submission failed: " + JSON.stringify(sent.errorResult ?? sent));
  }
  let got = await server.getTransaction(sent.hash);
  for (let i = 0; got.status === rpc.Api.GetTransactionStatus.NOT_FOUND && i < 40; i += 1) {
    await sleep(1000);
    got = await server.getTransaction(sent.hash);
  }
  if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error("Transaction failed: " + got.status);
  }
  return got.returnValue ? scValToNative(got.returnValue) : null;
}

// --- USDC -------------------------------------------------------------------

export async function usdcBalance(publicKey: string): Promise<bigint> {
  try {
    return BigInt((await simulateRead(usdcSacId, "balance", [scAddr(publicKey)])) as bigint);
  } catch {
    return 0n;
  }
}

export async function usdcBalanceLabel(publicKey: string): Promise<string> {
  return fromBaseUnits(await usdcBalance(publicKey));
}

export async function addUsdcTrustline(publicKey: string): Promise<void> {
  const account = await server.getAccount(publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", usdcIssuer) }))
    .setTimeout(60)
    .build();
  await signSendPoll(tx.toXDR(), publicKey);
}

// --- registry ---------------------------------------------------------------

export type OlioAccount = {
  owner: string;
  note_pubkey: Uint8Array;
  view_pubkey: Uint8Array;
  created: bigint;
};

export async function registerUsername(
  publicKey: string,
  username: string,
  notePubkey: Uint8Array,
  viewPubkey: Uint8Array
): Promise<void> {
  await invoke(publicKey, registryId, "register", [
    scAddr(publicKey),
    scStr(username),
    scBytes(notePubkey),
    scBytes(viewPubkey)
  ]);
}

export async function resolveUsername(username: string): Promise<OlioAccount | null> {
  try {
    const rec = (await simulateRead(registryId, "resolve", [scStr(username)])) as {
      owner: string;
      note_pubkey: unknown;
      view_pubkey: unknown;
      created: bigint;
    };
    return {
      owner: rec.owner,
      note_pubkey: toBytes(rec.note_pubkey),
      view_pubkey: toBytes(rec.view_pubkey),
      created: rec.created
    };
  } catch {
    return null;
  }
}

export async function usernameOf(publicKey: string): Promise<string | null> {
  return ((await simulateRead(registryId, "username_of", [scAddr(publicKey)])) as string) ?? null;
}

// --- pool -------------------------------------------------------------------

export async function poolDeposit(
  publicKey: string,
  commitment: Uint8Array,
  amount: bigint,
  ephemeralPk: Uint8Array,
  ciphertext: Uint8Array
): Promise<number> {
  const idx = await invoke(publicKey, poolId, "deposit", [
    scAddr(publicKey),
    scBytes(commitment),
    scI128(amount),
    scBytes(ephemeralPk),
    scBytes(ciphertext)
  ]);
  return Number(idx);
}

export async function poolWithdraw(
  publicKey: string,
  recipientStrkey: string,
  amount: bigint,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: RawProof
): Promise<void> {
  await invoke(publicKey, poolId, "withdraw", [
    scStr(recipientStrkey),
    scI128(amount),
    scBytes(root),
    scBytes(nullifier),
    scProof(proof)
  ]);
}

export async function isSpent(nullifierBytes: Uint8Array): Promise<boolean> {
  return Boolean(await simulateRead(poolId, "is_spent", [scBytes(nullifierBytes)]));
}

// --- deposit event scanning -------------------------------------------------

export type DepositEvent = {
  leafIndex: number;
  commitment: Uint8Array;
  ephemeralPk: Uint8Array;
  ciphertext: Uint8Array;
};

export async function scanDeposits(): Promise<DepositEvent[]> {
  const latest = await server.getLatestLedger();
  const filters = [{ type: "contract" as const, contractIds: [poolId] }];
  const windows = [17280, 8000, 2000, 500];

  let events: rpc.Api.EventResponse[] = [];
  for (const w of windows) {
    try {
      events = await pageEvents(Math.max(1, latest.sequence - w), filters);
      break;
    } catch {
      // window too large for retention; try a smaller one
    }
  }

  const out: DepositEvent[] = [];
  for (const e of events) {
    const val = scValToNative(
      typeof e.value === "string" ? xdr.ScVal.fromXDR(e.value, "base64") : e.value
    );
    if (!Array.isArray(val) || val.length !== 4) continue; // skip withdraw events
    out.push({
      leafIndex: Number(val[0]),
      commitment: toBytes(val[1]),
      ephemeralPk: toBytes(val[2]),
      ciphertext: toBytes(val[3])
    });
  }
  out.sort((a, b) => a.leafIndex - b.leafIndex);
  return out;
}

async function pageEvents(
  startLedger: number,
  filters: rpc.Server.GetEventsRequest["filters"]
): Promise<rpc.Api.EventResponse[]> {
  const collected: rpc.Api.EventResponse[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const req = cursor ? { cursor, filters, limit: 200 } : { startLedger, filters, limit: 200 };
    const res = await server.getEvents(req as rpc.Server.GetEventsRequest);
    collected.push(...res.events);
    const next = (res as { cursor?: string }).cursor ?? res.events.at(-1)?.pagingToken;
    if (res.events.length < 200 || !next) break;
    cursor = next;
  }
  return collected;
}
