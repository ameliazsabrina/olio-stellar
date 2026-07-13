import {
  commitment,
  encryptNote,
  fromBE,
  merkleProof,
  nullifier as nullifierHash,
  ownerPk,
  randomFieldElement,
  TREE_DEPTH,
  toBE32,
  viewPubkey,
} from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { proveTransfer, type TransferInput } from "./prover";
import { type OlioAccount, poolTransfer, type Signer } from "./stellar";

export type TransferResult = {
  recipientIndex: number;
  changeIndex: number;
  provingMs: number;
};

/// Pick the smallest single unspent note that covers `amount`. Returns null if
/// no single note is large enough (v1 can't combine notes).
export function selectInputNote(
  notes: MyNote[],
  amount: bigint,
): MyNote | null {
  const candidates = notes.filter((n) => !n.spent && n.amount >= amount);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, n) => (n.amount < best.amount ? n : best));
}

/// The largest single unspent note — the max a v1 transfer can send in one go.
export function largestNote(notes: MyNote[]): bigint {
  return notes
    .filter((n) => !n.spent)
    .reduce((max, n) => (n.amount > max ? n.amount : max), 0n);
}

export async function sendTransfer(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  recipient: OlioAccount;
  amount: bigint; // recipient amount, base units
}): Promise<TransferResult> {
  const { signer, acct, scan, recipient, amount } = params;

  const inNote = selectInputNote(scan.notes, amount);
  if (!inNote) {
    throw new Error(
      "No single note covers this amount. Send a smaller amount or receive more first.",
    );
  }

  const changeAmount = inNote.amount - amount;
  const myPk = await ownerPk(acct.ownerSecret);
  const recipientPk = fromBE(recipient.note_pubkey);

  const mp = await merkleProof(scan.leaves, inNote.leafIndex, TREE_DEPTH);
  const nf = await nullifierHash(acct.ownerSecret, inNote.leafIndex);

  const recipientSalt = randomFieldElement();
  const changeSalt = randomFieldElement();
  const outRecipient = await commitment(amount, recipientPk, recipientSalt);
  const outChange = await commitment(changeAmount, myPk, changeSalt);

  // Recipient note is encrypted to the recipient's viewing key; the change note
  // to the sender's own, so each side rediscovers its note when scanning.
  const recEnc = encryptNote(recipient.view_pubkey, amount, recipientSalt);
  const chgEnc = encryptNote(viewPubkey(acct.viewSk), changeAmount, changeSalt);

  const input: TransferInput = {
    root: mp.root.toString(),
    nullifier: nf.toString(),
    outCommitmentRecipient: outRecipient.toString(),
    outCommitmentChange: outChange.toString(),
    inAmount: inNote.amount.toString(),
    ownerSecret: acct.ownerSecret.toString(),
    inSalt: inNote.salt.toString(),
    pathElements: mp.pathElements.map((x) => x.toString()),
    pathIndices: mp.pathIndices,
    recipientPk: recipientPk.toString(),
    recipientAmount: amount.toString(),
    recipientSalt: recipientSalt.toString(),
    changeAmount: changeAmount.toString(),
    changeSalt: changeSalt.toString(),
  };

  const { proof, ms } = await proveTransfer(input);

  const { recipientIndex, changeIndex } = await poolTransfer(
    signer,
    toBE32(mp.root),
    toBE32(nf),
    proof,
    {
      commitment: toBE32(outRecipient),
      ephemeralPk: recEnc.ephemeralPk,
      ciphertext: recEnc.ciphertext,
    },
    {
      commitment: toBE32(outChange),
      ephemeralPk: chgEnc.ephemeralPk,
      ciphertext: chgEnc.ciphertext,
    },
  );

  return { recipientIndex, changeIndex, provingMs: ms };
}
