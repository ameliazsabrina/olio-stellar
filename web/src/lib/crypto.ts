// Note cryptography for the Olio shielded pool (iteration 2).
//
// Poseidon over BN254 (circomlibjs) matches the circuit (circomlib) and the
// contract (soroban-poseidon) — verified by fixed vectors + an on-chain
// root-parity test. All field elements are bigints < R, serialized big-endian
// to 32 bytes when crossing the contract/event boundary.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { buildPoseidon } from "circomlibjs";

export const R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const TREE_DEPTH = Number(process.env.NEXT_PUBLIC_POOL_DEPTH ?? 20);
export const USDC_DECIMALS = 7;

// --- Poseidon singleton -----------------------------------------------------

type PoseidonFn = ((inputs: bigint[]) => unknown) & {
  F: { toObject: (x: unknown) => bigint };
};
let _poseidon: PoseidonFn | null = null;

async function poseidon(): Promise<PoseidonFn> {
  if (!_poseidon) _poseidon = (await buildPoseidon()) as PoseidonFn;
  return _poseidon;
}

export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const p = await poseidon();
  return p.F.toObject(p(inputs));
}

// --- field <-> bytes --------------------------------------------------------

export function toBE32(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function fromBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return fromBE(bytes) % R;
}

// --- amount helpers ---------------------------------------------------------

export function toBaseUnits(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return (
    BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) +
    BigInt(fracPadded || "0")
  );
}

export function fromBaseUnits(units: bigint): string {
  const base = 10n ** BigInt(USDC_DECIMALS);
  const frac = (units % base)
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return frac ? `${units / base}.${frac}` : (units / base).toString();
}

// --- note primitives (match circuit + contract) -----------------------------

export const ownerPk = (ownerSecret: bigint) => poseidonHash([ownerSecret]);
export const commitment = (amount: bigint, pk: bigint, salt: bigint) =>
  poseidonHash([amount, pk, salt]);
export const nullifier = (ownerSecret: bigint, leafIndex: number) =>
  poseidonHash([ownerSecret, BigInt(leafIndex)]);

/// recipient field element = keccak256(strkey utf8) mod R (matches the contract).
export function recipientField(strkey: string): bigint {
  return fromBE(keccak_256(new TextEncoder().encode(strkey))) % R;
}

// --- incremental Merkle tree (Poseidon) -------------------------------------

export async function zeros(depth: number): Promise<bigint[]> {
  const out: bigint[] = [0n];
  for (let i = 0; i < depth; i += 1)
    out.push(await poseidonHash([out[i], out[i]]));
  return out;
}

/// Authentication path (siblings + direction bits) and root for `targetIndex`,
/// given all realized leaves in index order. Empty subtrees fall back to zeros.
export async function merkleProof(
  leaves: bigint[],
  targetIndex: number,
  depth: number,
): Promise<{ root: bigint; pathElements: bigint[]; pathIndices: number[] }> {
  const z = await zeros(depth);
  const maxIndex = leaves.length - 1;
  const memo = new Map<string, bigint>();

  const node = async (level: number, pos: number): Promise<bigint> => {
    if (level === 0) return leaves[pos] ?? z[0];
    if (pos * 2 ** level > maxIndex) return z[level];
    const key = `${level}:${pos}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const value = await poseidonHash([
      await node(level - 1, 2 * pos),
      await node(level - 1, 2 * pos + 1),
    ]);
    memo.set(key, value);
    return value;
  };

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  for (let level = 0; level < depth; level += 1) {
    const pos = targetIndex >> level;
    pathElements.push(await node(level, pos ^ 1));
    pathIndices.push((targetIndex >> level) & 1);
  }
  return { root: await node(depth, 0), pathElements, pathIndices };
}

// --- viewing keys + note encryption (x25519 + xchacha20poly1305) ------------

export type ViewKeypair = { sk: Uint8Array; pk: Uint8Array };

export function genViewKeypair(): ViewKeypair {
  const sk = x25519.utils.randomSecretKey();
  return { sk, pk: x25519.getPublicKey(sk) };
}

export function viewPubkey(sk: Uint8Array): Uint8Array {
  return x25519.getPublicKey(sk);
}

// plaintext = amount(16B BE) ‖ salt(32B BE)
function packNote(amount: bigint, salt: bigint): Uint8Array {
  const out = new Uint8Array(48);
  const a = toBE32(amount);
  out.set(a.slice(16), 0); // low 16 bytes of amount
  out.set(toBE32(salt), 16);
  return out;
}

function unpackNote(pt: Uint8Array): { amount: bigint; salt: bigint } {
  const amountBytes = new Uint8Array(32);
  amountBytes.set(pt.slice(0, 16), 16);
  return { amount: fromBE(amountBytes), salt: fromBE(pt.slice(16, 48)) };
}

/// Encrypt `{amount, salt}` to the recipient's viewing key. Returns the
/// ephemeral x25519 public key and `nonce‖ciphertext`.
export function encryptNote(
  recipientViewPk: Uint8Array,
  amount: bigint,
  salt: bigint,
): { ephemeralPk: Uint8Array; ciphertext: Uint8Array } {
  const ephSk = x25519.utils.randomSecretKey();
  const ephemeralPk = x25519.getPublicKey(ephSk);
  const key = sha256(x25519.getSharedSecret(ephSk, recipientViewPk));
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  const ct = xchacha20poly1305(key, nonce).encrypt(packNote(amount, salt));
  const out = new Uint8Array(24 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 24);
  return { ephemeralPk, ciphertext: out };
}

/// Try to decrypt a note. Returns null if it wasn't encrypted to `viewSk`.
export function decryptNote(
  viewSk: Uint8Array,
  ephemeralPk: Uint8Array,
  ciphertext: Uint8Array,
): { amount: bigint; salt: bigint } | null {
  try {
    const key = sha256(x25519.getSharedSecret(viewSk, ephemeralPk));
    const nonce = ciphertext.slice(0, 24);
    const pt = xchacha20poly1305(key, nonce).decrypt(ciphertext.slice(24));
    return unpackNote(pt);
  } catch {
    return null;
  }
}
