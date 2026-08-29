// @vitest-environment node

import { ownerPk, R, toBE32, viewPubkey } from "../src/lib/crypto";
import {
  assertPin,
  DEFAULT_KDF,
  decryptMaster,
  deriveMasterFromPrf,
  deriveNoteSecrets,
  deserializeEscrow,
  encryptMaster,
  randomMaster,
  rotateEscrow,
  serializeEscrow,
  verifyEscrowPin,
} from "../src/lib/keys";
import { BadPinError } from "../src/lib/pin-errors";

const PRF = new Uint8Array(32).fill(0x11);

describe("assertPin", () => {
  it("accepts exactly 6 digits", () => {
    expect(() => assertPin("012345")).not.toThrow();
  });
  it("rejects non-6-digit inputs", () => {
    for (const bad of ["12345", "1234567", "12a456", "", "abcdef"]) {
      expect(() => assertPin(bad)).toThrow();
    }
  });
});

describe("deriveMasterFromPrf", () => {
  it("is deterministic for the same PRF + PIN", () => {
    expect(deriveMasterFromPrf(PRF, "123456")).toEqual(
      deriveMasterFromPrf(PRF, "123456"),
    );
  });

  it("changes if either factor changes (both are required)", () => {
    const base = deriveMasterFromPrf(PRF, "123456");
    const otherPin = deriveMasterFromPrf(PRF, "654321");
    const otherPrf = deriveMasterFromPrf(
      new Uint8Array(32).fill(0x22),
      "123456",
    );
    expect(otherPin).not.toEqual(base);
    expect(otherPrf).not.toEqual(base);
  });
});

describe("deriveNoteSecrets", () => {
  it("derives an in-field owner secret and a usable view key, deterministically", () => {
    const master = deriveMasterFromPrf(PRF, "123456");
    const a = deriveNoteSecrets(master);
    const b = deriveNoteSecrets(master);

    expect(a.ownerSecret).toBe(b.ownerSecret);
    expect(a.ownerSecret).toBeGreaterThan(0n);
    expect(a.ownerSecret).toBeLessThan(R);
    expect(a.viewSk).toEqual(b.viewSk);
    expect(a.viewSk.length).toBe(32);
    // view secret is a valid x25519 key (public key derives without throwing).
    expect(viewPubkey(a.viewSk).length).toBe(32);
  });

  it("yields different secrets for different masters", () => {
    const s1 = deriveNoteSecrets(deriveMasterFromPrf(PRF, "111111"));
    const s2 = deriveNoteSecrets(deriveMasterFromPrf(PRF, "222222"));
    expect(s1.ownerSecret).not.toBe(s2.ownerSecret);
    expect(s1.viewSk).not.toEqual(s2.viewSk);
  });
});

describe("escrow round-trip", () => {
  // Argon2id is intentionally slow; give it headroom.
  it("decrypts with the correct PIN and fails with a wrong PIN", () => {
    const master = randomMaster();
    const blob = encryptMaster(master, "246810", DEFAULT_KDF);

    expect(decryptMaster(blob, "246810")).toEqual(master);
    expect(() => decryptMaster(blob, "999999")).toThrow();
  }, 20_000);

  it("survives hex transport across the tRPC boundary", () => {
    const master = randomMaster();
    const blob = encryptMaster(master, "135790", DEFAULT_KDF);
    const wire = serializeEscrow(blob);

    // Wire shape is JSON-safe (hex strings + structured params).
    expect(wire.encryptedMasterHex).toMatch(/^[0-9a-f]+$/);
    expect(wire.masterSaltHex).toMatch(/^[0-9a-f]+$/);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);

    const restored = deserializeEscrow(wire);
    expect(restored.ciphertext).toEqual(blob.ciphertext);
    expect(restored.salt).toEqual(blob.salt);
    expect(restored.params).toEqual(blob.params);
    expect(decryptMaster(restored, "135790")).toEqual(master);
  }, 20_000);
});

describe("escrow rotation", () => {
  it("verifies a PIN without exposing the decrypted master", () => {
    const current = serializeEscrow(encryptMaster(randomMaster(), "123456"));
    expect(() => verifyEscrowPin(current, "123456")).not.toThrow();
    expect(() => verifyEscrowPin(current, "654321")).toThrow(BadPinError);
  }, 20_000);

  it("re-wraps the same master and derived keys with fresh salt and ciphertext", async () => {
    const master = randomMaster();
    const current = serializeEscrow(encryptMaster(master, "123456"));
    const before = deriveNoteSecrets(master);

    const rotated = rotateEscrow(current, "123456", "654321");
    const recovered = decryptMaster(deserializeEscrow(rotated), "654321");
    const after = deriveNoteSecrets(recovered);

    expect(recovered).toEqual(master);
    expect(after.ownerSecret).toBe(before.ownerSecret);
    expect(after.viewSk).toEqual(before.viewSk);
    expect(toBE32(await ownerPk(after.ownerSecret))).toEqual(
      toBE32(await ownerPk(before.ownerSecret)),
    );
    expect(viewPubkey(after.viewSk)).toEqual(viewPubkey(before.viewSk));
    expect(rotated.masterSaltHex).not.toBe(current.masterSaltHex);
    expect(rotated.encryptedMasterHex).not.toBe(current.encryptedMasterHex);
    expect(() => decryptMaster(deserializeEscrow(rotated), "123456")).toThrow();
  }, 30_000);

  it("turns an authentication failure into BadPinError", () => {
    const current = serializeEscrow(encryptMaster(randomMaster(), "123456"));
    expect(() => rotateEscrow(current, "000000", "654321")).toThrow(
      BadPinError,
    );
  }, 20_000);
});
