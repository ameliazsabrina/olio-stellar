import { StrKey } from "@stellar/stellar-sdk";
import { horizon } from "./anchor";
import {
  clearPersistedBridge,
  createBridge,
  createClaimableBalanceToDestination,
  persistBridge,
  provisionBridge,
  releaseNoteToBridge,
} from "./bridge";
import {
  merkleProof,
  nullifier as nullifierHash,
  recipientField,
  TREE_DEPTH,
  toBE32,
} from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { proveWithdraw, type WithdrawInput } from "./prover";
import { poolWithdraw, type Signer } from "./stellar";

export type WithdrawResult = {
  provingMs: number;
  mode: "direct" | "claimable";
  claimableBalanceId?: string;
};

export type BatchWithdrawResult = {
  total: bigint; // base units successfully cashed out
  mode: "direct" | "claimable"; // shared destination, classified once
  succeeded: WithdrawResult[]; // per-note results, largest-first order
  failed: { leafIndex: number; amount: bigint; error: string }[];
};

const USDC_ASSET_CODE = "USDC";
const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER || "";

export async function classifyDestination(
  destination: string,
): Promise<"direct" | "needs-bridge"> {
  const dest = destination.trim();
  if (StrKey.isValidContract(dest)) return "direct";
  if (!StrKey.isValidEd25519PublicKey(dest)) {
    throw new Error("Enter a valid Stellar address (starts with G or C).");
  }

  let account: Awaited<ReturnType<typeof horizon.loadAccount>>;
  try {
    account = await horizon.loadAccount(dest);
  } catch {
    // Account not created yet — deliver as a claimable balance it can claim.
    return "needs-bridge";
  }

  const hasTrustline = account.balances.some(
    (b) =>
      "asset_code" in b &&
      b.asset_code === USDC_ASSET_CODE &&
      b.asset_issuer === USDC_ISSUER,
  );
  return hasTrustline ? "direct" : "needs-bridge";
}

export function isAlreadyCashedOut(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Error(Contract, #7)");
}

const ALREADY_CASHED_OUT_MESSAGE =
  "This payment was already cashed out. Refreshing your balance…";

export function claimableNotes(notes: MyNote[]): MyNote[] {
  return notes
    .filter((n) => !n.spent)
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
}

export function largestNote(notes: MyNote[]): bigint {
  return claimableNotes(notes).reduce(
    (max, n) => (n.amount > max ? n.amount : max),
    0n,
  );
}

/// A destination must be a Stellar account (G…) or contract (C…) address.
export function isValidDestination(address: string): boolean {
  const s = address.trim();
  return StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s);
}

export async function withdrawNote(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  destination: string;
}): Promise<WithdrawResult> {
  const { signer, acct, scan, note, destination } = params;
  const dest = destination.trim();

  // Route trustline-less / not-yet-created classic accounts through the bridge
  // so the receiver can cash out to ANY address. Contracts and trustline'd
  // accounts keep the direct, proof-bound path.
  if ((await classifyDestination(dest)) === "needs-bridge") {
    return cashOutViaBridge({ signer, acct, scan, note, destination: dest });
  }

  const { ms } = await directWithdraw({ signer, acct, scan, note, dest });
  return { provingMs: ms, mode: "direct" };
}

export async function withdrawAll(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  notes: MyNote[];
  destination: string;
}): Promise<BatchWithdrawResult> {
  const { signer, acct, scan, notes, destination } = params;
  const dest = destination.trim();

  // The destination is constant for the batch, so classify it once instead of
  // paying a Horizon round-trip per note.
  const routing = await classifyDestination(dest);
  const mode = routing === "needs-bridge" ? "claimable" : "direct";

  const succeeded: WithdrawResult[] = [];
  const failed: BatchWithdrawResult["failed"] = [];
  let total = 0n;

  for (const note of claimableNotes(notes)) {
    try {
      let result: WithdrawResult;
      if (routing === "needs-bridge") {
        result = await cashOutViaBridge({
          signer,
          acct,
          scan,
          note,
          destination: dest,
        });
      } else {
        const { ms } = await directWithdraw({ signer, acct, scan, note, dest });
        result = { provingMs: ms, mode: "direct" };
      }
      succeeded.push(result);
      total += note.amount;
    } catch (error) {
      failed.push({
        leafIndex: note.leafIndex,
        amount: note.amount,
        error: isAlreadyCashedOut(error)
          ? ALREADY_CASHED_OUT_MESSAGE
          : error instanceof Error
            ? error.message
            : "Withdrawal failed.",
      });
    }
  }

  return { total, mode, succeeded, failed };
}

async function directWithdraw(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  dest: string;
}): Promise<{ ms: number }> {
  const { signer, acct, scan, note, dest } = params;

  const mp = await merkleProof(scan.leaves, note.leafIndex, TREE_DEPTH);
  const nf = await nullifierHash(acct.ownerSecret, note.leafIndex);

  const input: WithdrawInput = {
    root: mp.root.toString(),
    nullifier: nf.toString(),
    recipient: recipientField(dest).toString(),
    amount: note.amount.toString(),
    ownerSecret: acct.ownerSecret.toString(),
    salt: note.salt.toString(),
    pathElements: mp.pathElements.map((x) => x.toString()),
    pathIndices: mp.pathIndices,
  };

  const { proof, ms } = await proveWithdraw(input);

  await poolWithdraw(
    signer,
    dest,
    note.amount,
    toBE32(mp.root),
    toBE32(nf),
    proof,
  );

  return { ms };
}

async function cashOutViaBridge(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  destination: string;
}): Promise<WithdrawResult> {
  const { signer, acct, scan, note, destination } = params;

  const bridge = createBridge();
  await provisionBridge(bridge);
  // Persist the bridge key before spending so a failed forward is recoverable, not stranded on a lost in-memory key.
  persistBridge(bridge, bridge.publicKey, note.amount, destination);
  const { provingMs } = await releaseNoteToBridge({
    signer,
    acct,
    scan,
    note,
    bridge,
  });
  const claimableBalanceId = await createClaimableBalanceToDestination(
    bridge.keypair,
    destination,
    note.amount,
  );
  clearPersistedBridge(bridge.publicKey);

  return { provingMs, mode: "claimable", claimableBalanceId };
}
