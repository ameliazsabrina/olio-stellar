import { gcm } from "@noble/ciphers/aes.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, fromBE, hexToBytes, R } from "./crypto";

const utf8 = (s: string) => new TextEncoder().encode(s);
const MASTER_INFO = utf8("olio.master.v1");
const OWNER_INFO = utf8("olio.owner.v1");
const VIEW_INFO = utf8("olio.view.v1");
const MASTER_LEN = 32;

export type KdfParams = { m: number; t: number; p: number };
export const DEFAULT_KDF: KdfParams = { m: 19456, t: 2, p: 1 };

export function assertPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must be exactly 6 digits");
}

function pinBytes(pin: string): Uint8Array {
  assertPin(pin);
  return new TextEncoder().encode(pin);
}

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

export function deriveNoteSecrets(master: Uint8Array): NoteSecrets {
  const ownerBytes = hkdf(sha512, master, undefined, OWNER_INFO, 64);
  const viewSk = hkdf(sha512, master, undefined, VIEW_INFO, 32);
  return { ownerSecret: fromBE(ownerBytes) % R, viewSk };
}

export function randomMaster(): Uint8Array {
  return randomBytes(MASTER_LEN);
}

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

export type EscrowTransport = {
  encryptedMasterHex: string;
  masterSaltHex: string;
  kdfParams: KdfParams;
};

export function serializeEscrow(blob: EscrowBlob): EscrowTransport {
  return {
    encryptedMasterHex: bytesToHex(blob.ciphertext),
    masterSaltHex: bytesToHex(blob.salt),
    kdfParams: blob.params,
  };
}

export function deserializeEscrow(t: EscrowTransport): EscrowBlob {
  return {
    ciphertext: hexToBytes(t.encryptedMasterHex),
    salt: hexToBytes(t.masterSaltHex),
    params: t.kdfParams,
  };
}
