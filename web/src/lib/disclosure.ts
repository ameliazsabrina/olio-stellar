import {
  bytesToHex,
  commitment as commitmentHash,
  fromBaseUnits,
  merkleProof,
  ownerPk as ownerPkHash,
  poseidonHash,
  toBE32,
  TREE_DEPTH,
} from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { networkPassphrase, poolId } from "./stellar";

export const DISCLOSURE_VERSION = 1 as const;

export type DisclosureBundle = {
  version: typeof DISCLOSURE_VERSION;
  pool: string;
  network: string;
  leafIndex: number;
  commitmentHex: string;
  commitment: string;
  rootHex: string;
  root: string;
  amount: string; // base units (7-dp USDC)
  amountLabel: string; // human "12.5"
  ownerPk: string;
  salt: string;
  pathElements: string[];
  pathIndices: number[];
  username: string | null;
  disclosedAt: string; // ISO-8601
};

export async function buildDisclosure(params: {
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  username?: string | null;
}): Promise<DisclosureBundle> {
  const { acct, scan, note, username } = params;

  const ownerPk = await ownerPkHash(acct.ownerSecret);
  const comm = await commitmentHash(note.amount, ownerPk, note.salt);
  const mp = await merkleProof(scan.leaves, note.leafIndex, TREE_DEPTH);

  return {
    version: DISCLOSURE_VERSION,
    pool: poolId,
    network: networkPassphrase,
    leafIndex: note.leafIndex,
    commitmentHex: bytesToHex(toBE32(comm)),
    commitment: comm.toString(),
    rootHex: bytesToHex(toBE32(mp.root)),
    root: mp.root.toString(),
    amount: note.amount.toString(),
    amountLabel: fromBaseUnits(note.amount),
    ownerPk: ownerPk.toString(),
    salt: note.salt.toString(),
    pathElements: mp.pathElements.map((x) => x.toString()),
    pathIndices: mp.pathIndices,
    username: username ?? null,
    disclosedAt: new Date().toISOString(),
  };
}

export type DisclosureCheck = {
  commitmentOk: boolean;
  rootOk: boolean;
  valid: boolean;
};

export async function verifyDisclosure(
  bundle: DisclosureBundle,
): Promise<DisclosureCheck> {
  const amount = BigInt(bundle.amount);
  const ownerPk = BigInt(bundle.ownerPk);
  const salt = BigInt(bundle.salt);

  const comm = await commitmentHash(amount, ownerPk, salt);
  const commitmentOk = comm.toString() === bundle.commitment;

  let node = comm;
  for (let i = 0; i < bundle.pathElements.length; i += 1) {
    const sibling = BigInt(bundle.pathElements[i]);
    node =
      bundle.pathIndices[i] === 0
        ? await poseidonHash([node, sibling])
        : await poseidonHash([sibling, node]);
  }
  const rootOk = node.toString() === bundle.root;

  return { commitmentOk, rootOk, valid: commitmentOk && rootOk };
}
