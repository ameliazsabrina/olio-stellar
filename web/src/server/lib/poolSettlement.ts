import "server-only";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { encryptNote, fromBE } from "../../lib/crypto";
import { feeQuoteScVal, type SignedFeeQuote } from "../../lib/fee-quote";
import { proveDeposit, type RawProof } from "../../lib/prover";
import { networkPassphrase, server } from "../../lib/stellar";

export type SequenceLock = {
  assert(remainingMs?: number): Promise<void>;
  release(): Promise<void>;
};

export type SettlementDeps = {
  claimLock: (key: string, durationMs: number) => Promise<SequenceLock | null>;
  lockKey: (publicKey: string) => string;
  relayError: (message: string) => Error;
  busyError: () => Error;
};

export type PreparedCallback = (
  txHash: string,
  timeBounds: { minTime: number; maxTime: number },
) => Promise<void>;

const SEQUENCE_LOCK_MS = 180_000;
const SUBMIT_WINDOW_MS = 130_000;
const CONFIRM_POLLS = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const scAddr = (s: string) => new Address(s).toScVal();
export const scBytes = (b: Uint8Array) =>
  xdr.ScVal.scvBytes(b as unknown as Buffer);
export const scI128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
export const scBytesHex = (h: string) =>
  xdr.ScVal.scvBytes(Buffer.from(h.startsWith("0x") ? h.slice(2) : h, "hex"));
export function scProof(proof: RawProof) {
  const entry = (key: string, value: Uint8Array) =>
    new xdr.ScMapEntry({
      key: nativeToScVal(key, { type: "symbol" }),
      val: scBytes(value),
    });
  return xdr.ScVal.scvMap([
    entry("a", proof.a),
    entry("b", proof.b),
    entry("c", proof.c),
  ]);
}

export function settlementKeypair(
  secret: string | undefined,
  missing: () => Error,
  invalid: () => Error = missing,
): Keypair {
  if (!secret) throw missing();
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw invalid();
  }
}

export async function invokeAsSource(
  deps: SettlementDeps,
  kp: Keypair,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  onPrepared?: PreparedCallback,
): Promise<{ value: unknown; txHash: string }> {
  const sequenceLock = await deps.claimLock(
    deps.lockKey(kp.publicKey()),
    SEQUENCE_LOCK_MS,
  );
  if (!sequenceLock) throw deps.busyError();
  let confirmed = false;
  try {
    const account = await server.getAccount(kp.publicKey());
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimebounds(nowSeconds - 60, nowSeconds + 120)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw deps.relayError(sim.error);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(kp);
    const preparedHash = prepared.hash().toString("hex");
    const bounds = prepared.timeBounds;
    if (!bounds)
      throw deps.relayError("Prepared transaction has no timebounds.");
    await onPrepared?.(preparedHash, {
      minTime: Number(bounds.minTime),
      maxTime: Number(bounds.maxTime),
    });

    await sequenceLock.assert(SUBMIT_WINDOW_MS);
    const send = await server.sendTransaction(prepared);
    if (send.status === "ERROR") {
      throw deps.relayError(
        `submit failed: ${JSON.stringify(send.errorResult)}`,
      );
    }
    let got = await server.getTransaction(send.hash);
    for (
      let i = 0;
      got.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      i < CONFIRM_POLLS;
      i += 1
    ) {
      await sleep(1000);
      got = await server.getTransaction(send.hash);
    }
    if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw deps.relayError(`transaction ${got.status}`);
    }
    confirmed = true;
    return {
      value: got.returnValue ? scValToNative(got.returnValue) : null,
      txHash: send.hash,
    };
  } finally {
    if (confirmed) await sequenceLock.release();
  }
}

export type NoteMaterial = {
  commitment: Uint8Array;
  amount: bigint;
  ownerPk: bigint;
  viewPubkey: Uint8Array;
  salt: bigint;
};

export async function proveNote(
  note: NoteMaterial,
  zkDir = `${process.cwd()}/public/zk`,
) {
  const { proof } = await proveDeposit(
    {
      commitment: fromBE(note.commitment).toString(),
      amount: note.amount.toString(),
      ownerPk: note.ownerPk.toString(),
      salt: note.salt.toString(),
    },
    zkDir,
  );
  const { ephemeralPk, ciphertext } = encryptNote(
    note.viewPubkey,
    note.amount,
    note.salt,
  );
  return { proof, ephemeralPk, ciphertext };
}

export function depositArgs(
  note: Pick<NoteMaterial, "commitment" | "amount">,
  quote: SignedFeeQuote,
  signature: Uint8Array,
  proven: { proof: RawProof; ephemeralPk: Uint8Array; ciphertext: Uint8Array },
): xdr.ScVal[] {
  return [
    scBytes(note.commitment),
    scI128(note.amount),
    feeQuoteScVal(quote),
    scBytes(signature),
    scProof(proven.proof),
    scBytes(proven.ephemeralPk),
    scBytes(proven.ciphertext),
  ];
}

export function leafIndexFrom(deps: SettlementDeps, value: unknown): number {
  const leafIndex = Number(value);
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0) {
    throw deps.relayError("Deposit result has no valid leaf index.");
  }
  return leafIndex;
}
