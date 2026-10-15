// @vitest-environment node

import { passportFileName, renderPassportPdf } from "../src/lib/passportPdf";
import type {
  PassportStatement,
  StatementRow,
} from "../src/server/modules/passport/passport.schema";

const DIGEST = "ab".repeat(32);
const VERIFY_URL = "https://olio.example/verify/pst_AAAAAAAAAAAAAAAAAAAAAA";

function row(index: number): StatementRow {
  return {
    date: new Date(Date.UTC(2026, 3, 1 + (index % 28))).toISOString(),
    amount: String(1_000_000_000 + index),
    refunded: index % 7 === 0 ? "100000000" : "0",
    rail: index % 3 === 0 ? "cctp" : "direct",
    invoices: index % 2 === 0 ? [index + 1] : [],
    txHash: `${index.toString(16).padStart(4, "0")}${"c".repeat(60)}`,
    evidenceLevel: index % 2 === 0 ? "intent_bound" : "attributed",
    payer: "GABC…WXYZ",
  };
}

function statement(
  overrides: Partial<PassportStatement> = {},
  rows: number | null = null,
): PassportStatement {
  return {
    kind: "olio.passport.statement",
    version: 1,
    statementId: "pst_AAAAAAAAAAAAAAAAAAAAAA",
    issuer: "olio",
    network: "testnet",
    poolId: "CPOOL",
    business: {
      displayName: "Warung Verified",
      type: "company",
      verified: true,
      checkedAt: "2026-09-21T10:00:00.000Z",
      validUntil: "2027-09-21T10:00:00.000Z",
    },
    period: {
      preset: "12m",
      from: "2025-11-01T00:00:00.000Z",
      to: "2026-10-15T09:00:00.000Z",
    },
    detail: rows === null ? "summary" : "full",
    payerMask: rows === null ? null : "masked",
    summary: {
      totalReceived: "123450000000",
      paymentCount: rows ?? 12,
      distinctPayers: 4,
      excludedCount: 2,
    },
    months: Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 10 + index, 1));
      return {
        month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
        count: index % 4,
        amount: String((index % 4) * 1_000_000_000),
      };
    }),
    rows: rows === null ? null : Array.from({ length: rows }, (_, i) => row(i)),
    qualificationPolicyVersion: 1,
    recordsAsOf: "2026-10-15T08:55:00.000Z",
    issuedAt: "2026-10-15T09:00:00.000Z",
    expiresAt: "2027-01-13T09:00:00.000Z",
    ...overrides,
  };
}

function render(value: PassportStatement) {
  return renderPassportPdf({
    statement: value,
    digest: DIGEST,
    verifyUrl: VERIFY_URL,
    username: "warung",
    txUrl: (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  });
}

describe("passport PDF", () => {
  it("fits a monthly summary on one page", async () => {
    const doc = await render(statement());
    expect(doc.getNumberOfPages()).toBe(1);
    const text = doc.output();
    expect(text).toContain("(TRACK RECORD)");
    expect(text).toContain("(Warung Verified)");
    expect(text).toContain("Identity Verified");
    expect(text).toContain("12,345.00 USDC");
    expect(text).toContain("2 payments were left out");
    expect(text).toContain(DIGEST);
    expect(text).toContain(`/URI (${VERIFY_URL})`);
    expect(text).not.toContain("(Payments)");
  });

  it("says so when a full list has no payments", async () => {
    const doc = await render(statement({}, 0));
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.output()).toContain("No counted payments in this period.");
  });

  it("continues a 30-payment list onto a second page with headers", async () => {
    const doc = await render(statement({}, 30));
    expect(doc.getNumberOfPages()).toBe(2);
    const text = doc.output();
    expect(text).toContain("(Payments \\(continued\\))");
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("/URI (https://stellar.expert/explorer/testnet/tx/");
  });

  it("paginates 200 payments and footers every page", async () => {
    const doc = await render(statement({}, 200));
    const pages = doc.getNumberOfPages();
    expect(pages).toBe(7);
    const text = doc.output();
    for (let page = 1; page <= pages; page += 1) {
      expect(text).toContain(`Page ${page} of ${pages}`);
    }
  });

  it("prints full payer addresses on their own line", async () => {
    const payer = `G${"A".repeat(55)}`;
    const value = statement({ payerMask: "full" }, 3);
    value.rows = value.rows?.map((r) => ({ ...r, payer })) ?? null;
    const text = (await render(value)).output();
    expect(text).toContain(`Payer ${payer}`);
  });

  it("drops the payer column when payers are hidden", async () => {
    const value = statement({ payerMask: "hidden" }, 3);
    value.rows = value.rows?.map((r) => ({ ...r, payer: null })) ?? null;
    const text = (await render(value)).output();
    expect(text).not.toContain("(PAYER)");
    expect(text).not.toContain("GABC");
  });

  it("names the file after the user and issue date", () => {
    expect(passportFileName("warung", new Date(2026, 9, 15))).toBe(
      "OlioStatement-warung-2026-10-15.pdf",
    );
  });
});
