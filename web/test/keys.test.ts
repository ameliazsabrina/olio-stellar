// @vitest-environment node

import { R, viewPubkey } from "../src/lib/crypto";
import {
  assertPin,
  DEFAULT_KDF,
  decryptMaster,
  deriveMasterFromPrf,
  deriveNoteSecrets,
  encryptMaster,
  randomMaster,
} from "../src/lib/keys";

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
});
