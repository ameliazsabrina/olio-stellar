import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { env } from "../env";
import { api } from "../trpc/client";
import { bytesToHex, fromBaseUnits, hexToBytes } from "./crypto";
import { type FeeQuoteEnvelope, feeQuoteScVal } from "./fee-quote";
import type { RawProof } from "./prover";

export const networkPassphrase =
  env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
export const isMainnet = networkPassphrase === Networks.PUBLIC;
const configuredRpcUrl = env.NEXT_PUBLIC_STELLAR_RPC_URL;
if (isMainnet && !configuredRpcUrl) {
  throw new Error(
    "NEXT_PUBLIC_STELLAR_RPC_URL must be configured for mainnet.",
  );
}
export const rpcUrl = configuredRpcUrl || "https://soroban-testnet.stellar.org";
export const registryId = env.NEXT_PUBLIC_OLIO_REGISTRY_ID || "";
export const poolId = env.NEXT_PUBLIC_OLIO_POOL_ID || "";
export const usdcSacId = env.NEXT_PUBLIC_USDC_SAC_ID || "";

export const server = new rpc.Server(rpcUrl, {
  allowHttp: rpcUrl.startsWith("http://"),
});

export function explorerTxUrl(txHash: string): string {
  const net = networkPassphrase === Networks.PUBLIC ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${txHash}`;
}

export function explorerContractUrl(contractId: string): string {
  const net = networkPassphrase === Networks.PUBLIC ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/contract/${contractId}`;
}

export function explorerAccountUrl(publicKey: string): string {
  const net = networkPassphrase === Networks.PUBLIC ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/account/${publicKey}`;
}

const scAddr = (s: string) => new Address(s).toScVal();
const scStr = (s: string) => nativeToScVal(s, { type: "string" });
const scSym = (s: string) => nativeToScVal(s, { type: "symbol" });
const scBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(b as unknown as Buffer);
const scI128 = (v: bigint) => nativeToScVal(v, { type: "i128" });

function scProof(proof: RawProof): xdr.ScVal {
  const entry = (k: string, v: Uint8Array) =>
    new xdr.ScMapEntry({ key: scSym(k), val: scBytes(v) });
  return xdr.ScVal.scvMap([
    entry("a", proof.a),
    entry("b", proof.b),
    entry("c", proof.c),
  ]);
}

const toBytes = (v: unknown): Uint8Array =>
  v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);

export type Signer = {
  address: string;
  signAuthEntries: (
    entries: xdr.SorobanAuthorizationEntry[],
  ) => Promise<string[]>;
  relaySoroban: (func: string, auth: string[]) => Promise<{ hash: string }>;
};

export async function simulateRead(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  const source = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function invoke(
  signer: Signer,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<{ value: unknown; txHash: string }> {
  const op = new Contract(contractId).call(method, ...args);
  const hostFunction = op.body().invokeHostFunctionOp().hostFunction();

  const built = new TransactionBuilder(
    new Account(Keypair.random().publicKey(), "0"),
    { fee: BASE_FEE, networkPassphrase },
  )
    .addOperation(op)
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const entries = sim.result?.auth ?? [];

  const auth = await signer.signAuthEntries(entries);
  const { hash: txHash } = await signer.relaySoroban(
    hostFunction.toXDR("base64"),
    auth,
  );
  const value = await pollTransaction(txHash);
  return { value, txHash };
}

async function pollTransaction(txHash: string): Promise<unknown> {
  let got = await server.getTransaction(txHash);
  for (
    let i = 0;
    got.status === rpc.Api.GetTransactionStatus.NOT_FOUND && i < 40;
    i += 1
  ) {
    await sleep(1000);
    got = await server.getTransaction(txHash);
  }
  if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed: ${got.status}`);
  }
  return got.returnValue ? scValToNative(got.returnValue) : null;
}

export async function usdcBalance(publicKey: string): Promise<bigint> {
  try {
    return BigInt(
      (await simulateRead(usdcSacId, "balance", [scAddr(publicKey)])) as bigint,
    );
  } catch {
    return 0n;
  }
}

export async function usdcBalanceLabel(publicKey: string): Promise<string> {
  return fromBaseUnits(await usdcBalance(publicKey));
}

export type AccountStatus = {
  usdc: string;
};

export async function accountStatus(address: string): Promise<AccountStatus> {
  return { usdc: fromBaseUnits(await usdcBalance(address)) };
}

export type OlioAccount = {
  owner: string;
  note_pubkey: Uint8Array;
  view_pubkey: Uint8Array;
  created: bigint;
};

export async function registerUsername(
  signer: Signer,
  username: string,
  notePubkey: Uint8Array,
  viewPubkey: Uint8Array,
): Promise<void> {
  try {
    await invoke(signer, registryId, "register", [
      scAddr(signer.address),
      scStr(username),
      scBytes(notePubkey),
      scBytes(viewPubkey),
    ]);
  } catch (error) {
    throw friendlyRegistryError(error);
  }
}

const REGISTRY_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  1: "That username is already owned by another account.",
  2: "This wallet already owns a different username on this network.",
  3: "Your username was not found on the current Stellar network.",
  4: "Username must be at least 3 characters.",
  5: "Username must be no more than 32 characters.",
};

/** Extract a typed registry error from Stellar's verbose HostError text. */
export function registryContractErrorCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Error\(Contract,\s*#(\d+)\)/);
  return match ? Number(match[1]) : null;
}

function friendlyRegistryError(error: unknown): unknown {
  const code = registryContractErrorCode(error);
  return code === null
    ? error
    : new Error(
        REGISTRY_ERROR_MESSAGES[code] ??
          "The username registry rejected this request. Please try again.",
        { cause: error },
      );
}

export async function setUsernamePubkeys(
  signer: Signer,
  username: string,
  notePubkey: Uint8Array,
  viewPubkey: Uint8Array,
): Promise<void> {
  const args = [
    scAddr(signer.address),
    scStr(username),
    scBytes(notePubkey),
    scBytes(viewPubkey),
  ];

  try {
    await invoke(signer, registryId, "set_pubkey", args);
  } catch (error) {
    if (registryContractErrorCode(error) !== 3) {
      throw friendlyRegistryError(error);
    }

    try {
      await invoke(signer, registryId, "register", args);
    } catch (registerError) {
      throw friendlyRegistryError(registerError);
    }
  }
}

export async function resolveUsernameOnChain(
  username: string,
): Promise<OlioAccount | null> {
  try {
    const rec = (await simulateRead(registryId, "resolve", [
      scStr(username),
    ])) as {
      owner: string;
      note_pubkey: unknown;
      view_pubkey: unknown;
      created: bigint;
    };
    return {
      owner: rec.owner,
      note_pubkey: toBytes(rec.note_pubkey),
      view_pubkey: toBytes(rec.view_pubkey),
      created: rec.created,
    };
  } catch (error) {
    if (registryContractErrorCode(error) === 3) return null;
    throw error;
  }
}

export async function usernameOfOnChain(
  publicKey: string,
): Promise<string | null> {
  return (
    ((await simulateRead(registryId, "username_of", [
      scAddr(publicKey),
    ])) as string) ?? null
  );
}

export async function resolveUsername(
  username: string,
): Promise<OlioAccount | null> {
  try {
    const rec = await api.usernames.resolve.query({ username });
    if (!rec) return null;
    return {
      owner: rec.owner,
      note_pubkey: hexToBytes(rec.notePubkeyHex),
      view_pubkey: hexToBytes(rec.viewPubkeyHex),
      created: BigInt(Math.floor(new Date(rec.createdAt).getTime() / 1000)),
    };
  } catch {
    return resolveUsernameOnChain(username);
  }
}

export async function usernameOf(publicKey: string): Promise<string | null> {
  try {
    return await api.usernames.byOwner.query({ owner: publicKey });
  } catch {
    return usernameOfOnChain(publicKey);
  }
}

export async function registerUsernameCache(username: string): Promise<void> {
  await api.usernames.register.mutate({ username });
}

export async function poolDeposit(
  signer: Signer,
  commitment: Uint8Array,
  amount: bigint,
  feeQuote: FeeQuoteEnvelope,
  proof: RawProof,
  ephemeralPk: Uint8Array,
  ciphertext: Uint8Array,
): Promise<{ leafIndex: number; txHash: string }> {
  const { value, txHash } = await invoke(signer, poolId, "deposit", [
    scAddr(signer.address),
    scBytes(commitment),
    scI128(amount),
    feeQuoteScVal(feeQuote.quote),
    scBytes(feeQuote.signature),
    scProof(proof),
    scBytes(ephemeralPk),
    scBytes(ciphertext),
  ]);
  return { leafIndex: Number(value), txHash };
}

export async function transferUsdc(
  signer: Signer,
  destination: string,
  amount: bigint,
): Promise<string> {
  const { txHash } = await invoke(signer, usdcSacId, "transfer", [
    scAddr(signer.address),
    scAddr(destination),
    scI128(amount),
  ]);
  return txHash;
}

export async function poolWithdraw(
  signer: Signer,
  recipientStrkey: string,
  amount: bigint,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: RawProof,
): Promise<void> {
  await invoke(signer, poolId, "withdraw", [
    scStr(recipientStrkey),
    scI128(amount),
    scBytes(root),
    scBytes(nullifier),
    scProof(proof),
  ]);
}

export type TransferNote = {
  commitment: Uint8Array;
  ephemeralPk: Uint8Array;
  ciphertext: Uint8Array;
};

export async function poolTransfer(
  signer: Signer,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: RawProof,
  recipient: TransferNote,
  change: TransferNote,
): Promise<{ recipientIndex: number; changeIndex: number }> {
  const { value } = await invoke(signer, poolId, "transfer", [
    scBytes(root),
    scBytes(nullifier),
    scProof(proof),
    scBytes(recipient.commitment),
    scBytes(recipient.ephemeralPk),
    scBytes(recipient.ciphertext),
    scBytes(change.commitment),
    scBytes(change.ephemeralPk),
    scBytes(change.ciphertext),
  ]);
  const res = value as [unknown, unknown];
  return { recipientIndex: Number(res[0]), changeIndex: Number(res[1]) };
}

export async function isSpent(nullifierBytes: Uint8Array): Promise<boolean> {
  return Boolean(
    await simulateRead(poolId, "is_spent", [scBytes(nullifierBytes)]),
  );
}

export type DepositEvent = {
  leafIndex: number;
  commitment: Uint8Array;
  ephemeralPk: Uint8Array;
  ciphertext: Uint8Array;
  receivedAt?: string;
};

export type SpentEvent = {
  nullifierHex: string;
};

export type FeeEvent = {
  payer: string;
  feeRecipient: string;
  paymentAmount: bigint;
  feeAmount: bigint;
  totalAmount: bigint;
  policyVersion: number;
  feeBps: number;
  quoteId: string;
};

function poolEventKind(e: rpc.Api.EventResponse): string | null {
  const topic = e.topic.at(0);
  return topic ? String(scValToNative(topic)) : null;
}

export function parseDepositEvent(
  e: rpc.Api.EventResponse,
): DepositEvent | null {
  if (poolEventKind(e) !== "deposit") return null;
  const val = scValToNative(
    typeof e.value === "string"
      ? xdr.ScVal.fromXDR(e.value, "base64")
      : e.value,
  );
  if (!Array.isArray(val) || val.length < 4) return null;
  return {
    leafIndex: Number(val[0]),
    commitment: toBytes(val[1]),
    ephemeralPk: toBytes(val[2]),
    ciphertext: toBytes(val[3]),
  };
}

export function parseSpentEvent(e: rpc.Api.EventResponse): SpentEvent | null {
  if (poolEventKind(e) !== "spend") return null;
  const val = scValToNative(
    typeof e.value === "string"
      ? xdr.ScVal.fromXDR(e.value, "base64")
      : e.value,
  );
  const bytes = toBytes(val);
  if (bytes.length !== 32) return null;
  return { nullifierHex: bytesToHex(bytes) };
}

export function parseFeeEvent(e: rpc.Api.EventResponse): FeeEvent | null {
  if (poolEventKind(e) !== "fee") return null;
  const val = scValToNative(
    typeof e.value === "string"
      ? xdr.ScVal.fromXDR(e.value, "base64")
      : e.value,
  ) as Record<string, unknown> | null;
  if (!val || Array.isArray(val) || typeof val !== "object") return null;
  try {
    const parsed = {
      payer: String(val.payer),
      feeRecipient: String(val.fee_recipient),
      paymentAmount: BigInt(val.payment_amount as bigint),
      feeAmount: BigInt(val.fee_amount as bigint),
      totalAmount: BigInt(val.total_amount as bigint),
      policyVersion: Number(val.policy_version),
      feeBps: Number(val.fee_bps),
      quoteId: bytesToHex(toBytes(val.quote_id)),
    };
    if (
      !parsed.payer ||
      !parsed.feeRecipient ||
      parsed.paymentAmount <= 0n ||
      parsed.feeAmount < 0n ||
      parsed.totalAmount !== parsed.paymentAmount + parsed.feeAmount ||
      !Number.isInteger(parsed.policyVersion) ||
      ![200, 500].includes(parsed.feeBps) ||
      !/^[0-9a-f]{64}$/.test(parsed.quoteId)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchPoolEventsSince(sinceLedger: number): Promise<{
  events: rpc.Api.EventResponse[];
  scannedFromLedger: number;
  latestLedger: number;
}> {
  const latest = await server.getLatestLedger();
  const filters = [{ type: "contract" as const, contractIds: [poolId] }];

  const preferred = Math.max(1, sinceLedger + 1);
  try {
    const events = await pageEvents(preferred, filters);
    return {
      events,
      scannedFromLedger: preferred,
      latestLedger: latest.sequence,
    };
  } catch {}

  const windows = [17280, 8000, 2000, 500];
  for (const w of windows) {
    const start = Math.max(1, latest.sequence - w);
    try {
      const events = await pageEvents(start, filters);
      return {
        events,
        scannedFromLedger: start,
        latestLedger: latest.sequence,
      };
    } catch {}
  }
  return {
    events: [],
    scannedFromLedger: latest.sequence,
    latestLedger: latest.sequence,
  };
}

export async function scanDepositsOnChain(): Promise<DepositEvent[]> {
  const { events } = await fetchPoolEventsSince(0);
  const out: DepositEvent[] = [];
  for (const e of events) {
    const parsed = parseDepositEvent(e);
    if (parsed) out.push(parsed);
  }
  out.sort((a, b) => a.leafIndex - b.leafIndex);
  return out;
}

export async function scanDeposits(): Promise<DepositEvent[]> {
  try {
    const rows = await api.deposits.list.query({ since: -1 });
    return rows
      .map((r) => ({
        leafIndex: r.leafIndex,
        commitment: hexToBytes(r.commitmentHex),
        ephemeralPk: hexToBytes(r.ephemeralPkHex),
        ciphertext: hexToBytes(r.ciphertextHex),
        receivedAt: r.ts,
      }))
      .sort((a, b) => a.leafIndex - b.leafIndex);
  } catch {
    return scanDepositsOnChain();
  }
}

export async function pageEvents(
  startLedger: number,
  filters: rpc.Server.GetEventsRequest["filters"],
): Promise<rpc.Api.EventResponse[]> {
  const collected: rpc.Api.EventResponse[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i += 1) {
    const req = cursor
      ? { cursor, filters, limit: 200 }
      : { startLedger, filters, limit: 200 };
    const res = await server.getEvents(req as rpc.Server.GetEventsRequest);
    collected.push(...res.events);
    const next = (res as { cursor?: string }).cursor ?? res.events.at(-1)?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return collected;
}
