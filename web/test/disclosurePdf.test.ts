// @vitest-environment node

import type { DisclosureBundle } from "../src/lib/disclosure";
import { renderDisclosurePdf } from "../src/lib/disclosurePdf";

const bundle: DisclosureBundle = {
  version: 1,
  pool: "CCV6AL2P3CYSF7FVRR4QEB5375TGX4VOXHEF3QI4QSZVJXV3O7VXWX53",
  network: "Test SDF Network ; September 2015",
  leafIndex: 3,
  commitmentHex: "aa".repeat(32),
  commitment: "42",
  rootHex: "bb".repeat(32),
  root: "99",
  amount: "125000000",
  amountLabel: "12.5",
  ownerPk: "7",
  salt: "13",
  pathElements: ["1", "2", "3"],
  pathIndices: [0, 1, 0],
  username: "amelia",
  disclosedAt: "2026-07-13T00:00:00.000Z",
};

describe("renderDisclosurePdf", () => {
  it("produces a non-empty PDF document", async () => {
    const doc = await renderDisclosurePdf(bundle);
    const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
    // Valid PDFs start with the "%PDF" magic header.
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(5000);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });
});
