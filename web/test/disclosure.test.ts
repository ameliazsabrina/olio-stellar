// @vitest-environment node

import {
  commitment as commitmentHash,
  ownerPk as ownerPkHash,
} from "../src/lib/crypto";
import { buildDisclosure, verifyDisclosure } from "../src/lib/disclosure";
import type { LocalAccount, ScanResult } from "../src/lib/notes";

const ownerSecret =
  123456789012345678901234567890123456789012345678901234567890n;
const amount = 12_5000000n; // 12.5 USDC
const salt = 987654321n;

async function fixture(): Promise<{ acct: LocalAccount; scan: ScanResult }> {
  const acct: LocalAccount = { ownerSecret, viewSk: new Uint8Array(32) };
  const pk = await ownerPkHash(ownerSecret);
  const leaf = await commitmentHash(amount, pk, salt);
  const scan: ScanResult = {
    notes: [{ leafIndex: 0, amount, salt, spent: false }],
    leaves: [leaf],
    claimable: amount,
  };
  return { acct, scan };
}

describe("disclosure", () => {
  it("round-trips: a freshly built bundle verifies", async () => {
    const { acct, scan } = await fixture();
    const bundle = await buildDisclosure({
      acct,
      scan,
      note: scan.notes[0],
      username: "amelia",
    });

    expect(bundle.amountLabel).toBe("12.5");
    expect(bundle.username).toBe("amelia");
    expect(bundle.pathElements).toHaveLength(bundle.pathIndices.length);

    const check = await verifyDisclosure(bundle);
    expect(check).toEqual({ commitmentOk: true, rootOk: true, valid: true });
  });

  it("rejects a tampered amount (commitment no longer opens)", async () => {
    const { acct, scan } = await fixture();
    const bundle = await buildDisclosure({ acct, scan, note: scan.notes[0] });

    const forged = { ...bundle, amount: (amount + 1n).toString() };
    const check = await verifyDisclosure(forged);
    expect(check.commitmentOk).toBe(false);
    expect(check.valid).toBe(false);
  });

  it("rejects a tampered Merkle root", async () => {
    const { acct, scan } = await fixture();
    const bundle = await buildDisclosure({ acct, scan, note: scan.notes[0] });

    const forged = { ...bundle, root: (BigInt(bundle.root) + 1n).toString() };
    const check = await verifyDisclosure(forged);
    expect(check.commitmentOk).toBe(true);
    expect(check.rootOk).toBe(false);
    expect(check.valid).toBe(false);
  });
});
