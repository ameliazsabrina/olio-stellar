import { StrKey } from "@stellar/stellar-sdk";
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

export type WithdrawResult = { provingMs: number };

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

  const mp = await merkleProof(scan.leaves, note.leafIndex, TREE_DEPTH);
  const nf = await nullifierHash(acct.ownerSecret, note.leafIndex);

  const input: WithdrawInput = {
    root: mp.root.toString(),
    nullifier: nf.toString(),
    recipient: recipientField(destination).toString(),
    amount: note.amount.toString(),
    ownerSecret: acct.ownerSecret.toString(),
    salt: note.salt.toString(),
    pathElements: mp.pathElements.map((x) => x.toString()),
    pathIndices: mp.pathIndices,
  };

  const { proof, ms } = await proveWithdraw(input);

  await poolWithdraw(
    signer,
    destination,
    note.amount,
    toBE32(mp.root),
    toBE32(nf),
    proof,
  );

  return { provingMs: ms };
}
