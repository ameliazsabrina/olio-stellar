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
import { api } from "../trpc/client";
import { fromBaseUnits, hexToBytes } from "./crypto";
import type { RawProof } from "./prover";

export const networkPassphrase =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
export const rpcUrl =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org";
export const registryId = process.env.NEXT_PUBLIC_OLIO_REGISTRY_ID || "";
export const poolId = process.env.NEXT_PUBLIC_OLIO_POOL_ID || "";
export const usdcSacId = process.env.NEXT_PUBLIC_USDC_SAC_ID || "";

export const server = new rpc.Server(rpcUrl, {
  allowHttp: rpcUrl.startsWith("http://"),
});

export function explorerTxUrl(txHash: string): string {
  const net = networkPassphrase === Networks.PUBLIC ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${txHash}`;
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
  // Sign Soroban authorization entries and return them as base64 XDR. Returns
  // base64 (not live xdr objects) because passkey-kit uses a separately-bundled
  // js-xdr — objects can't cross that boundary, only bytes can.
  signAuthEntries: (
    entries: xdr.SorobanAuthorizationEntry[],
  ) => Promise<string[]>;
  // Relay a Soroban func+auth invocation gaslessly through the Channels service.
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

// Invoke a contract method gaslessly. Every wallet is a passkey smart wallet, so
// this is the only path: simulate for the required auth entries, sign them, and
// relay a func+auth invocation through the Channels service — the relayer's
// channel account is the tx source and pays the fee, so the user needs no XLM.
export async function invoke(
  signer: Signer,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<{ value: unknown; txHash: string }> {
  const op = new Contract(contractId).call(method, ...args);
  const hostFunction = op.body().invokeHostFunctionOp().hostFunction();

  // Simulate to discover required auth entries. Use a throwaway source (NOT the
  // user) so the user's require_auth resolves to a detached address credential we
  // sign — a source-account credential would be rejected by the relayer, whose
  // channel account is the real tx source.
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

// Every wallet is a passkey smart-wallet contract, which holds USDC directly as
// a SAC balance — no classic account, XLM, or trustline involved.
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
  await invoke(signer, registryId, "register", [
    scAddr(signer.address),
    scStr(username),
    scBytes(notePubkey),
    scBytes(viewPubkey),
  ]);
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
  } catch {
    return null;
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
  ephemeralPk: Uint8Array,
  ciphertext: Uint8Array,
): Promise<{ leafIndex: number; txHash: string }> {
  const { value, txHash } = await invoke(signer, poolId, "deposit", [
    scAddr(signer.address),
    scBytes(commitment),
    scI128(amount),
    scBytes(ephemeralPk),
    scBytes(ciphertext),
  ]);
  return { leafIndex: Number(value), txHash };
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

/// Shielded transfer: spend a note (root + nullifier + proof) and mint two new
/// notes — one for the recipient, one for the sender's change — in one gasless
/// call. Returns the two new leaf indices. No value leaves the pool.
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
};

export function parseDepositEvent(
  e: rpc.Api.EventResponse,
): DepositEvent | null {
  const val = scValToNative(
    typeof e.value === "string"
      ? xdr.ScVal.fromXDR(e.value, "base64")
      : e.value,
  );
  if (!Array.isArray(val) || val.length !== 4) return null;
  return {
    leafIndex: Number(val[0]),
    commitment: toBytes(val[1]),
    ephemeralPk: toBytes(val[2]),
    ciphertext: toBytes(val[3]),
  };
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
  } catch {
    // preferred start is outside RPC retention; fall back to whatever's still retained.
  }

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
    } catch {
      // window too large for retention; try a smaller one
    }
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
  // Soroban `getEvents` scans only a bounded ledger window per call and returns
  // a continuation cursor even when the page is empty or short — a matching
  // event can sit several pages past an empty leading page. So we must NOT stop
  // on a short page (the old `events.length < 200` break dropped events that
  // were one cursor-hop away, silently returning []). Keep following the cursor
  // until the RPC stops advancing it, i.e. we've caught up to the tip.
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
