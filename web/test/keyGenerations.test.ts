import { describe, expect, it } from "vitest";
import { bytesToHex, ownerPk, toBE32 } from "../src/lib/crypto";
import {
  decryptPriorSecrets,
  deriveAllGenerations,
  deriveNoteSecrets,
  encryptMaster,
  encryptPriorSecrets,
  nextGeneration,
  randomMaster,
  rotateEscrow,
  serializeEscrow,
} from "../src/lib/keys";
import { BadPinError } from "../src/lib/pin-errors";

const FAST_KDF = { m: 64, t: 1, p: 1 };

async function escrowWithHistory(pin: string) {
  const previous = deriveNoteSecrets(randomMaster());
  const master = randomMaster();
  const notePubkeyHex = bytesToHex(toBE32(await ownerPk(previous.ownerSecret)));
  return {
    previous,
    master,
    escrow: {
      ...serializeEscrow(encryptMaster(master, pin, FAST_KDF)),
      priorEscrows: [
        encryptPriorSecrets(previous, pin, 1, notePubkeyHex, FAST_KDF),
      ],
    },
  };
}

describe("historical key generations", () => {
  it("round-trips retired note secrets under the recovery PIN", () => {
    const secrets = deriveNoteSecrets(randomMaster());
    const prior = encryptPriorSecrets(
      secrets,
      "123456",
      1,
      "00".repeat(32),
      FAST_KDF,
    );
    const recovered = decryptPriorSecrets(prior, "123456");
    expect(recovered.ownerSecret).toBe(secrets.ownerSecret);
    expect(recovered.viewSk).toEqual(secrets.viewSk);
    expect(() => decryptPriorSecrets(prior, "654321")).toThrow();
  });

  it("derives the current generation first, then every retired one", async () => {
    const { previous, master, escrow } = await escrowWithHistory("123456");
    const generations = deriveAllGenerations(escrow, "123456");
    expect(generations.map((g) => [g.generation, g.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(generations[0].secrets.ownerSecret).toBe(
      deriveNoteSecrets(master).ownerSecret,
    );
    expect(generations[1].secrets.ownerSecret).toBe(previous.ownerSecret);
    expect(nextGeneration(escrow)).toBe(2);
    expect(() => deriveAllGenerations(escrow, "000000")).toThrow(BadPinError);
  });

  it("re-wraps every generation when the PIN changes", async () => {
    const { previous, escrow } = await escrowWithHistory("123456");
    const rotated = rotateEscrow(escrow, "123456", "654321");
    expect(rotated.priorEscrows).toHaveLength(1);
    expect(rotated.priorEscrows?.[0].generation).toBe(1);
    expect(rotated.priorEscrows?.[0].notePubkeyHex).toBe(
      escrow.priorEscrows[0].notePubkeyHex,
    );
    expect(rotated.priorEscrows?.[0].encryptedSecretsHex).not.toBe(
      escrow.priorEscrows[0].encryptedSecretsHex,
    );
    const generations = deriveAllGenerations(rotated, "654321");
    expect(generations[1].secrets.ownerSecret).toBe(previous.ownerSecret);
    expect(() => deriveAllGenerations(rotated, "123456")).toThrow(BadPinError);
  }, 30_000);
});
