// Two-factor derivation of Olio's ZK note secrets, modeled on Pivy's 6-digit
// scheme. A `masterSecret` is derived from a high-entropy device factor (the
// WebAuthn PRF output, supplied by lib/passkey.ts) mixed with the user's 6-digit
// PIN. The note secrets (Poseidon owner secret + x25519 view key) are then
// derived deterministically from the master, so they never need a plaintext
// backup and are recoverable from the same two factors.
//
// For authenticators without PRF, `encryptMaster`/`decryptMaster` escrow a random
// master under an Argon2id(PIN) key (AES-256-GCM); the ciphertext lives server-
// side and is only released to an authenticated session. This module is pure and
// framework-free — all WebAuthn/navigator calls live in lib/passkey.ts.

import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { fromBE, R } from "./crypto";

const utf8 = (s: string) => new TextEncoder().encode(s);
const MASTER_INFO = utf8("olio.master.v1");
const OWNER_INFO = utf8("olio.owner.v1");
const VIEW_INFO = utf8("olio.view.v1");
const MASTER_LEN = 32;

// Argon2id cost for the escrow fallback. Stored alongside the ciphertext so
// params can be tuned later without breaking existing blobs. OWASP-baseline
// memory-hard settings; runs once per unlock, client-side.
export type KdfParams = { m: number; t: number; p: number };
export const DEFAULT_KDF: KdfParams = { m: 19456, t: 2, p: 1 };

export function assertPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must be exactly 6 digits");
}

function pinBytes(pin: string): Uint8Array {
  assertPin(pin);
  return new TextEncoder().encode(pin);
}

// masterSecret = HKDF-SHA512(ikm = prfOutput ‖ pin, info = domain). The PRF
// output is the high-entropy factor that makes a 6-digit PIN safe; both are
// required, matching Pivy's "wallet + PIN, neither alone".
export function deriveMasterFromPrf(
  prfOutput: Uint8Array,
  pin: string,
): Uint8Array {
  return hkdf(
    sha512,
    concatBytes(prfOutput, pinBytes(pin)),
    undefined,
    MASTER_INFO,
    MASTER_LEN,
  );
}

export type NoteSecrets = { ownerSecret: bigint; viewSk: Uint8Array };

// Derive the Poseidon owner secret (a BN254 field element) and the x25519 view
// secret key from the master. 64 bytes reduced mod R keeps modular bias
// negligible; any 32 bytes is a valid x25519 secret (clamped internally).
export function deriveNoteSecrets(master: Uint8Array): NoteSecrets {
  const ownerBytes = hkdf(sha512, master, undefined, OWNER_INFO, 64);
  const viewSk = hkdf(sha512, master, undefined, VIEW_INFO, 32);
  return { ownerSecret: fromBE(ownerBytes) % R, viewSk };
}

export function randomMaster(): Uint8Array {
  return randomBytes(MASTER_LEN);
}

// --- escrow fallback (no-PRF authenticators) --------------------------------

function escrowKey(
  pin: string,
  salt: Uint8Array,
  params: KdfParams,
): Uint8Array {
  return argon2id(pinBytes(pin), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: 32,
  });
}

export type EscrowBlob = {
  ciphertext: Uint8Array; // nonce(12) ‖ AES-256-GCM(master)
  salt: Uint8Array;
  params: KdfParams;
};

export function encryptMaster(
  master: Uint8Array,
  pin: string,
  params: KdfParams = DEFAULT_KDF,
): EscrowBlob {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const ct = gcm(escrowKey(pin, salt, params), nonce).encrypt(master);
  return { ciphertext: concatBytes(nonce, ct), salt, params };
}

export function decryptMaster(blob: EscrowBlob, pin: string): Uint8Array {
  const nonce = blob.ciphertext.slice(0, 12);
  const ct = blob.ciphertext.slice(12);
  return gcm(escrowKey(pin, blob.salt, blob.params), nonce).decrypt(ct);
}
