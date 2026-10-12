import { gcm } from "@noble/ciphers/aes.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, fromBE, hexToBytes, R, toBE32 } from "./crypto";
import { BadPinError } from "./pin-errors";

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

export type PriorEscrowTransport = {
  generation: number;
  encryptedSecretsHex: string;
  saltHex: string;
  kdfParams: KdfParams;
  notePubkeyHex: string;
};

export type EscrowWithHistory = EscrowTransport & {
  priorEscrows?: PriorEscrowTransport[];
};

export type KeyGeneration = {
  generation: number;
  current: boolean;
  secrets: NoteSecrets;
};

function packSecrets(secrets: NoteSecrets): Uint8Array {
  return concatBytes(toBE32(secrets.ownerSecret), secrets.viewSk);
}

function unpackSecrets(bytes: Uint8Array): NoteSecrets {
  return {
    ownerSecret: fromBE(bytes.slice(0, 32)),
    viewSk: bytes.slice(32, 64),
  };
}

export function encryptPriorSecrets(
  secrets: NoteSecrets,
  pin: string,
  generation: number,
  notePubkeyHex: string,
  params: KdfParams = DEFAULT_KDF,
): PriorEscrowTransport {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const packed = packSecrets(secrets);
  try {
    const ct = gcm(escrowKey(pin, salt, params), nonce).encrypt(packed);
    return {
      generation,
      encryptedSecretsHex: bytesToHex(concatBytes(nonce, ct)),
      saltHex: bytesToHex(salt),
      kdfParams: params,
      notePubkeyHex,
    };
  } finally {
    packed.fill(0);
  }
}

export function decryptPriorSecrets(
  prior: PriorEscrowTransport,
  pin: string,
): NoteSecrets {
  const blob = hexToBytes(prior.encryptedSecretsHex);
  const packed = gcm(
    escrowKey(pin, hexToBytes(prior.saltHex), prior.kdfParams),
    blob.slice(0, 12),
  ).decrypt(blob.slice(12));
  return unpackSecrets(packed);
}

export function nextGeneration(escrow: EscrowWithHistory): number {
  return (
    (escrow.priorEscrows ?? []).reduce(
      (max, prior) => Math.max(max, prior.generation),
      0,
    ) + 1
  );
}

export function deriveAllGenerations(
  escrow: EscrowWithHistory,
  pin: string,
): KeyGeneration[] {
  assertPin(pin);
  let master: Uint8Array | undefined;
  try {
    try {
      master = decryptMaster(deserializeEscrow(escrow), pin);
    } catch {
      throw new BadPinError();
    }
    const generations: KeyGeneration[] = [
      {
        generation: nextGeneration(escrow),
        current: true,
        secrets: deriveNoteSecrets(master),
      },
    ];
    const priors = [...(escrow.priorEscrows ?? [])].sort(
      (a, b) => b.generation - a.generation,
    );
    for (const prior of priors) {
      try {
        generations.push({
          generation: prior.generation,
          current: false,
          secrets: decryptPriorSecrets(prior, pin),
        });
      } catch {
        throw new BadPinError();
      }
    }
    return generations;
  } finally {
    master?.fill(0);
  }
}

export function verifyEscrowPin(
  currentEscrow: EscrowTransport,
  pin: string,
): void {
  assertPin(pin);
  let master: Uint8Array | undefined;
  try {
    try {
      master = decryptMaster(deserializeEscrow(currentEscrow), pin);
    } catch {
      throw new BadPinError();
    }
  } finally {
    master?.fill(0);
  }
}

export function rotateEscrow(
  currentEscrow: EscrowWithHistory,
  currentPin: string,
  newPin: string,
): EscrowWithHistory {
  assertPin(currentPin);
  assertPin(newPin);
  const blob = deserializeEscrow(currentEscrow);
  let master: Uint8Array | undefined;
  try {
    try {
      master = decryptMaster(blob, currentPin);
    } catch {
      throw new BadPinError();
    }
    const rotated = serializeEscrow(encryptMaster(master, newPin, DEFAULT_KDF));
    if (!currentEscrow.priorEscrows) return rotated;
    return {
      ...rotated,
      priorEscrows: currentEscrow.priorEscrows.map((prior) => {
        let secrets: NoteSecrets;
        try {
          secrets = decryptPriorSecrets(prior, currentPin);
        } catch {
          throw new BadPinError();
        }
        try {
          return encryptPriorSecrets(
            secrets,
            newPin,
            prior.generation,
            prior.notePubkeyHex,
          );
        } finally {
          secrets.viewSk.fill(0);
        }
      }),
    };
  } finally {
    master?.fill(0);
  }
}
