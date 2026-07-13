import {
  bytesToHex,
  commitment,
  decryptNote,
  fromBE,
  hexToBytes,
  nullifier,
  ownerPk,
  TREE_DEPTH,
  toBE32,
  viewPubkey,
} from "./crypto";
import { deriveNoteSecrets } from "./keys";
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

/// True when this browser already holds cached note secrets. localStorage is a
/// cache of secrets derived from the recoverable master, never the source of
/// truth — the master lives in the PIN-escrow. WalletProvider uses this to
/// decide whether a restored session still needs to unlock its master.
export function hasLocalAccount(): boolean {
  return getAccount() !== null;
}

/// Derive the deterministic note secrets from the recoverable master and cache
/// them in localStorage. The same master always yields the same owner/view
/// keypair (see deriveNoteSecrets), so a re-derive on any device reproduces the
/// exact pubkeys registered on-chain — that is what makes balances recoverable.
export function deriveAndStoreAccount(master: Uint8Array): LocalAccount {
  const { ownerSecret, viewSk } = deriveNoteSecrets(master);
  window.localStorage.setItem(OWNER_KEY, bytesToHex(toBE32(ownerSecret)));
  window.localStorage.setItem(VIEW_KEY, bytesToHex(viewSk));
  return { ownerSecret, viewSk };
}

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
  const debug = process.env.NODE_ENV !== "production";
  if (debug) {
    // Derived pubkeys must equal what's registered for your username in the
    // registry/Mongo. If these don't match, the payer encrypted to keys this
    // browser can't decrypt → notes are invisible and the balance stays 0.
    console.info("[olio] scan", {
      deposits: deposits.length,
      myViewPubkey_b64: btoa(String.fromCharCode(...viewPubkey(acct.viewSk))),
      myNotePubkey_b64: btoa(String.fromCharCode(...toBE32(myPk))),
    });
  }
  const notes: MyNote[] = [];
  for (const d of deposits) {
    const dec = decryptNote(acct.viewSk, d.ephemeralPk, d.ciphertext);
    if (!dec) {
      if (debug) console.info(`[olio] leaf ${d.leafIndex}: not mine (decrypt)`);
      continue;
    }
    // Belt-and-suspenders: the recomputed commitment must match the leaf.
    if (
      (await commitment(dec.amount, myPk, dec.salt)) !== fromBE(d.commitment)
    ) {
      if (debug)
        console.warn(
          `[olio] leaf ${d.leafIndex}: decrypted but commitment mismatch — owner key differs from the one registered at pay time`,
        );
      continue;
    }
    if (debug)
      console.info(`[olio] leaf ${d.leafIndex}: MINE, amount=${dec.amount}`);
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
