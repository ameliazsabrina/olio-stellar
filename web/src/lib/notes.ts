import {
  bytesToHex,
  commitment,
  decryptNote,
  fromBE,
  genViewKeypair,
  hexToBytes,
  nullifier,
  ownerPk,
  randomFieldElement,
  TREE_DEPTH,
  toBE32,
  viewPubkey,
} from "./crypto";
import { type DepositEvent, isSpent, scanDeposits } from "./stellar";

const OWNER_KEY = "olio.ownerSecret";
const VIEW_KEY = "olio.viewSecret";
const USERNAME_KEY = "olio.username";

export type LocalAccount = { ownerSecret: bigint; viewSk: Uint8Array };

export function getAccount(): LocalAccount | null {
  if (typeof window === "undefined") return null;
  const owner = window.localStorage.getItem(OWNER_KEY);
  const view = window.localStorage.getItem(VIEW_KEY);
  if (!owner || !view) return null;
  return { ownerSecret: fromBE(hexToBytes(owner)), viewSk: hexToBytes(view) };
}

export function ensureAccount(): LocalAccount {
  const existing = getAccount();
  if (existing) return existing;
  const ownerSecret = randomFieldElement();
  const view = genViewKeypair();
  window.localStorage.setItem(OWNER_KEY, bytesToHex(toBE32(ownerSecret)));
  window.localStorage.setItem(VIEW_KEY, bytesToHex(view.sk));
  return { ownerSecret, viewSk: view.sk };
}

/// Public keys to register: Poseidon owner_pk (32B BE) + x25519 view_pubkey.
export async function accountPubkeys(
  acct: LocalAccount,
): Promise<{ notePubkey: Uint8Array; viewPubkey: Uint8Array }> {
  return {
    notePubkey: toBE32(await ownerPk(acct.ownerSecret)),
    viewPubkey: viewPubkey(acct.viewSk),
  };
}

export function setStoredUsername(username: string): void {
  window.localStorage.setItem(USERNAME_KEY, username);
}

export type MyNote = {
  leafIndex: number;
  amount: bigint;
  salt: bigint;
  spent: boolean;
};
export type ScanResult = {
  notes: MyNote[];
  leaves: bigint[];
  claimable: bigint;
};

/// Scan the pool, decrypting each deposit; the ones that decrypt are ours.
/// Also returns the full ordered leaf set needed to build Merkle proofs.
export async function scanMyNotes(acct: LocalAccount): Promise<ScanResult> {
  const deposits: DepositEvent[] = await scanDeposits();
  const leaves: bigint[] = [];
  for (const d of deposits) leaves[d.leafIndex] = fromBE(d.commitment);

  const myPk = await ownerPk(acct.ownerSecret);
  const notes: MyNote[] = [];
  for (const d of deposits) {
    const dec = decryptNote(acct.viewSk, d.ephemeralPk, d.ciphertext);
    if (!dec) continue;
    // Belt-and-suspenders: the recomputed commitment must match the leaf.
    if ((await commitment(dec.amount, myPk, dec.salt)) !== fromBE(d.commitment))
      continue;
    const spent = await isSpent(
      toBE32(await nullifier(acct.ownerSecret, d.leafIndex)),
    );
    notes.push({
      leafIndex: d.leafIndex,
      amount: dec.amount,
      salt: dec.salt,
      spent,
    });
  }

  const claimable = notes
    .filter((n) => !n.spent)
    .reduce((s, n) => s + n.amount, 0n);
  return { notes, leaves, claimable };
}

export { TREE_DEPTH };
