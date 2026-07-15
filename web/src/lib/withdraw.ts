import { StrKey } from "@stellar/stellar-sdk";
import { horizon } from "./anchor";
import {
  createBridge,
  createClaimableBalanceToDestination,
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

// How the payout reached the destination:
//   "direct"    — SAC transfer straight to the destination (contract, or a
//                 classic account that already holds a USDC trustline). This
//                 keeps the destination bound in the ZK proof: fully trustless.
//   "claimable" — the destination is a classic account without a USDC trustline
//                 (or not created yet), so we routed through an ephemeral bridge
//                 and left the funds as a Stellar claimable balance the
//                 recipient claims later.
export type WithdrawResult = {
  provingMs: number;
  mode: "direct" | "claimable";
  claimableBalanceId?: string;
};

// Aggregate outcome of cashing out several notes to one destination in a single
// action. Each note is released independently (see `withdrawAll`), so a batch
// can partially succeed: `succeeded`/`total` cover the notes that went through,
// `failed` lists the ones that didn't (still unspent and retryable).
export type BatchWithdrawResult = {
  total: bigint; // base units successfully cashed out
  mode: "direct" | "claimable"; // shared destination, classified once
  succeeded: WithdrawResult[]; // per-note results, largest-first order
  failed: { leafIndex: number; amount: bigint; error: string }[];
};

// The pool releases USDC by calling the SAC's `transfer`, which credits a
// classic account's trustline balance. Classic accounts (G…) must therefore
// hold a USDC trustline first; without one the SAC traps with
// Error(Contract, #13) "trustline entry is missing". Contracts (C…) — including
// our passkey smart wallets — take a SAC balance entry directly and need no
// trustline. The issuer is the same USDC we deposit into the pool.
const USDC_ASSET_CODE = "USDC";
const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER || "";

/// Decide how a cash-out to `destination` must be delivered. Contracts and
/// classic accounts that already hold a USDC trustline can receive a direct SAC
/// transfer (proof-bound, trustless). A classic account with no trustline — or
/// one that doesn't exist on-chain yet — cannot, so it needs the bridge +
/// claimable-balance path. Throws only for a malformed strkey.
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

/// Cash out EVERY claimable note to a single destination in one action. The
/// withdraw circuit has no change output (see `withdrawNote`), so there is no
/// "withdraw an arbitrary total" primitive — this simply loops the single-note
/// release over each note.
///
/// Notes are processed SEQUENTIALLY: the passkey signer + gasless relay can't be
/// driven in parallel without racing. Every note proves against the SAME `scan`
/// snapshot — a withdrawal spends a nullifier, it never mutates the Merkle
/// leaves, so the root stays valid for the whole batch (no re-scan needed
/// between notes). A note that fails does not abort the rest: it lands in
/// `failed` (still unspent, retryable) and the loop continues.
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
        error: error instanceof Error ? error.message : "Withdrawal failed.",
      });
    }
  }

  return { total, mode, succeeded, failed };
}

/// The low-level direct withdraw: prove against `dest` and release the note from
/// the pool straight to it via the SAC transfer. `dest` must already be able to
/// receive (contract, or classic with a USDC trustline) — the caller classifies.
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

/// Cash out to a classic account that can't receive a direct SAC transfer.
/// A fresh ephemeral bridge (funded + USDC-trustlined) takes the zk-withdrawn
/// note, then hands the funds to the destination as a Stellar claimable balance
/// — the recipient claims it later, adding the USDC trustline as they claim.
/// The note is spent once released to the bridge, so the claimable-balance
/// submit retries internally to avoid stranding funds mid-flow.
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

  return { provingMs, mode: "claimable", claimableBalanceId };
}
