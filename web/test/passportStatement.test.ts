import { beforeEach, describe, expect, it, vi } from "vitest";

const RECORDS_AS_OF = new Date("2026-10-15T08:55:00.000Z");

const mocks = vi.hoisted(() => ({
  gate: {
    open: true,
    reasons: [] as string[],
    asOf: null as Date | null,
  },
  credentialOk: true,
  settlements: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  audit: vi.fn(),
  invoiceRefs: new Map<string, { invoiceId: string; number: number }[]>(),
}));

vi.mock("../src/lib/stellar", () => ({
  poolId: "CPOOL",
  stellarNetwork: "testnet",
}));
vi.mock("../src/server/modules/evidence/evidence.gate", () => ({
  recordsGate: async () => mocks.gate,
  credentialBacksNetwork: () => mocks.credentialOk,
}));
vi.mock("../src/server/modules/settlements/settlements.service", () => ({
  invoiceRefsFor: async () => mocks.invoiceRefs,
}));
vi.mock("../src/server/modules/verification/verification.config", () => ({
  verificationConfig: () => ({ environment: "sandbox" }),
}));
vi.mock("../src/server/modules/businesses/businesses.service", () => ({
  assertManager: async (_user: string, businessId: string) => ({
    business: {
      _id: businessId,
      publicId: "pub_abcdef",
      type: "company",
      lifecycle: "active",
      displayName: "Warung Verified",
    },
    role: "owner",
  }),
  newOpaqueId: (bytes = 12) =>
    require("node:crypto").randomBytes(bytes).toString("base64url"),
  recordAudit: mocks.audit,
}));
vi.mock("../src/server/db/mongo", () => {
  type Filter = {
    businessId: string;
    ledgerClosedAt?: { $gte: Date; $lte: Date };
  };
  const inRange = (doc: Record<string, unknown>, filter: Filter) => {
    const at = doc.ledgerClosedAt as Date;
    const range = filter.ledgerClosedAt;
    return !range || (at >= range.$gte && at <= range.$lte);
  };
  return {
    getSettlements: async () => ({
      find: (filter: Filter) => ({
        project: () => ({
          toArray: async () =>
            mocks.settlements.filter(
              (doc) =>
                doc.businessId === filter.businessId && inRange(doc, filter),
            ),
        }),
      }),
      findOne: async () =>
        [...mocks.settlements].sort(
          (a, b) =>
            (a.ledgerClosedAt as Date).getTime() -
            (b.ledgerClosedAt as Date).getTime(),
        )[0] ?? null,
    }),
    getIdentityCredentials: async () => ({
      findOne: async () => ({
        checkedAt: new Date("2026-09-21T10:00:00.000Z"),
        validUntil: new Date("2027-09-21T10:00:00.000Z"),
      }),
    }),
    getPassportStatements: async () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        mocks.inserted.push(doc);
      },
    }),
  };
});

import type { ActivitySettlement } from "../src/server/modules/passport/passport.statement";
import {
  assertRecordsComplete,
  issueStatement,
  maskPayer,
  monthsBetween,
  periodStart,
  statementDigest,
  statementStatus,
  summarizeActivity,
} from "../src/server/modules/passport/passport.statement";

const PAYER_A = `GA${"A".repeat(54)}`;
const PAYER_B = `GB${"B".repeat(54)}`;
const OWN = `GC${"C".repeat(54)}`;

function settlement(
  id: string,
  overrides: Partial<ActivitySettlement> = {},
): ActivitySettlement & { businessId: string } {
  return {
    _id: id,
    businessId: "biz_1",
    amount: 100_000_000n,
    refundedAmount: 0n,
    payer: PAYER_A,
    ledgerClosedAt: new Date("2026-09-10T12:00:00.000Z"),
    rail: "direct",
    txHash: `${id}${"0".repeat(60)}`.slice(0, 64),
    evidenceLevel: "attributed",
    qualification: { counted: true, selfFunded: false, policyVersion: 1 },
    ...overrides,
  };
}

const AUG = new Date("2026-08-01T00:00:00.000Z");
const NOW = new Date("2026-10-15T09:00:00.000Z");

function summarize(
  rows: ActivitySettlement[],
  detail: "summary" | "full" = "summary",
  payerMask: "masked" | "full" | "hidden" = "masked",
) {
  return summarizeActivity(rows, { from: AUG, to: NOW, detail, payerMask });
}

beforeEach(() => {
  mocks.gate = { open: true, reasons: [], asOf: RECORDS_AS_OF };
  mocks.credentialOk = true;
  mocks.settlements = [];
  mocks.inserted = [];
  mocks.invoiceRefs = new Map();
  mocks.audit.mockReset();
});

describe("statement periods", () => {
  it("starts rolling periods on the first of a UTC month", () => {
    expect(periodStart("3m", NOW, null).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(periodStart("12m", NOW, null).toISOString()).toBe(
      "2025-11-01T00:00:00.000Z",
    );
  });

  it("starts all time at the month of the earliest settlement", () => {
    expect(
      periodStart("all", NOW, new Date("2026-03-17T05:00:00Z")).toISOString(),
    ).toBe("2026-03-01T00:00:00.000Z");
    expect(periodStart("all", NOW, null).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("lists every month in the period, including the current one", () => {
    expect(monthsBetween(AUG, NOW)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("activity totals", () => {
  it("counts qualified payments net of partial refunds", () => {
    const activity = summarize([
      settlement("a"),
      settlement("b", { refundedAmount: 40_000_000n, payer: PAYER_B }),
    ]);
    expect(activity.summary).toEqual({
      totalReceived: "160000000",
      paymentCount: 2,
      distinctPayers: 2,
      excludedCount: 0,
    });
  });

  it("leaves self-funded and fully refunded payments out and says how many", () => {
    const activity = summarize([
      settlement("a"),
      settlement("own", {
        payer: OWN,
        qualification: { counted: false, selfFunded: true, policyVersion: 1 },
      }),
      settlement("refunded", {
        refundedAmount: 100_000_000n,
        qualification: { counted: false, selfFunded: false, policyVersion: 1 },
      }),
      settlement("unpriced", { amount: null }),
    ]);
    expect(activity.summary.totalReceived).toBe("100000000");
    expect(activity.summary.paymentCount).toBe(1);
    expect(activity.summary.distinctPayers).toBe(1);
    expect(activity.summary.excludedCount).toBe(3);
  });

  it("ignores settlements outside the period", () => {
    const activity = summarize([
      settlement("before", {
        ledgerClosedAt: new Date("2026-07-31T23:59:59Z"),
      }),
      settlement("inside", {
        ledgerClosedAt: new Date("2026-08-01T00:00:00Z"),
      }),
      settlement("after", { ledgerClosedAt: new Date("2026-10-16T00:00:00Z") }),
    ]);
    expect(activity.summary.paymentCount).toBe(1);
    expect(activity.summary.excludedCount).toBe(0);
  });

  it("buckets payments by UTC month and keeps empty months", () => {
    const activity = summarize([
      settlement("a", { ledgerClosedAt: new Date("2026-08-31T23:30:00Z") }),
      settlement("b", { ledgerClosedAt: new Date("2026-10-02T00:30:00Z") }),
      settlement("c", {
        ledgerClosedAt: new Date("2026-10-03T00:30:00Z"),
        refundedAmount: 50_000_000n,
      }),
    ]);
    expect(activity.months).toEqual([
      { month: "2026-08", count: 1, amount: "100000000" },
      { month: "2026-09", count: 0, amount: "0" },
      { month: "2026-10", count: 2, amount: "150000000" },
    ]);
  });

  it("returns rows only for a full list, oldest first", () => {
    expect(summarize([settlement("a")]).rows).toBeNull();
    const rows = summarizeActivity(
      [
        settlement("late", {
          ledgerClosedAt: new Date("2026-10-01T00:00:00Z"),
        }),
        settlement("early", {
          ledgerClosedAt: new Date("2026-08-02T00:00:00Z"),
          rail: "cctp",
          evidenceLevel: "intent_bound",
        }),
      ],
      {
        from: AUG,
        to: NOW,
        detail: "full",
        payerMask: "masked",
        invoiceNumbers: new Map([["early", [7]]]),
      },
    ).rows;
    expect(rows?.map((row) => row.invoices)).toEqual([[7], []]);
    expect(rows?.[0]).toMatchObject({
      amount: "100000000",
      refunded: "0",
      rail: "cctp",
      evidenceLevel: "intent_bound",
      payer: "GAAA…AAAA",
    });
  });
});

describe("payer masking", () => {
  it("masks, shows or hides payer addresses", () => {
    expect(maskPayer(PAYER_B, "masked")).toBe("GBBB…BBBB");
    expect(maskPayer(PAYER_B, "full")).toBe(PAYER_B);
    expect(maskPayer(PAYER_B, "hidden")).toBeNull();
    expect(maskPayer(null, "full")).toBeNull();
  });

  it("applies the mask to every row", () => {
    const rows = summarize([settlement("a")], "full", "hidden").rows;
    expect(rows?.[0].payer).toBeNull();
  });
});

describe("digest", () => {
  it("binds the stored digest to the statement content", async () => {
    mocks.settlements = [settlement("a")];
    const issued = await issueStatement(
      "did:privy:owner",
      {
        businessId: "biz_1",
        detail: "summary",
        period: "3m",
        payerMask: "masked",
      },
      NOW,
    );
    expect(issued.digest).toBe(statementDigest(issued.statement));
    expect(issued).not.toHaveProperty("signature");
  });

  it("changes the digest when any field changes", async () => {
    mocks.settlements = [settlement("a")];
    const { statement, digest } = await issueStatement(
      "did:privy:owner",
      {
        businessId: "biz_1",
        detail: "summary",
        period: "3m",
        payerMask: "masked",
      },
      NOW,
    );
    const tampered = {
      ...statement,
      summary: { ...statement.summary, totalReceived: "999000000000" },
    };
    expect(statementDigest(tampered)).not.toBe(digest);
    const reordered = Object.fromEntries(
      Object.entries(statement).reverse(),
    ) as typeof statement;
    expect(statementDigest(reordered)).toBe(digest);
  });
});

describe("issuing a statement", () => {
  it("stores totals and the digest, never rows or payer addresses", async () => {
    mocks.settlements = [settlement("a"), settlement("b", { payer: PAYER_B })];
    const issued = await issueStatement(
      "did:privy:owner",
      { businessId: "biz_1", detail: "full", period: "12m", payerMask: "full" },
      NOW,
    );
    expect(issued.statement.rows).toHaveLength(2);
    expect(issued.statement.business).toEqual({
      displayName: "Warung Verified",
      type: "company",
      verified: true,
      checkedAt: "2026-09-21T10:00:00.000Z",
      validUntil: "2027-09-21T10:00:00.000Z",
    });
    expect(issued.statement.expiresAt).toBe("2027-01-13T09:00:00.000Z");
    expect(issued.statement.recordsAsOf).toBe(RECORDS_AS_OF.toISOString());
    expect(issued.verifyPath).toBe(`/verify/${issued.statement.statementId}`);
    expect(mocks.inserted).toHaveLength(1);
    const stored = JSON.stringify(mocks.inserted[0]);
    expect(stored).not.toContain(PAYER_A);
    expect(stored).not.toContain(PAYER_B);
    expect(mocks.inserted[0]).not.toHaveProperty("rows");
    expect(mocks.inserted[0]).toMatchObject({
      digest: issued.digest,
      recordsAsOf: RECORDS_AS_OF,
      payerMask: "full",
      summary: { paymentCount: 2, totalReceived: "200000000" },
      revokedAt: null,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "passport.statement_issued" }),
    );
  });

  it("drops the payer mask from a summary", async () => {
    const issued = await issueStatement(
      "did:privy:owner",
      {
        businessId: "biz_1",
        detail: "summary",
        period: "6m",
        payerMask: "full",
      },
      NOW,
    );
    expect(issued.statement.payerMask).toBeNull();
    expect(issued.statement.rows).toBeNull();
    expect(issued.statement.months).toHaveLength(6);
  });

  it("says when payments are still syncing and stores nothing", async () => {
    mocks.gate = {
      open: false,
      reasons: ["reconcile_behind"],
      asOf: RECORDS_AS_OF,
    };
    await expect(
      issueStatement(
        "did:privy:owner",
        {
          businessId: "biz_1",
          detail: "summary",
          period: "3m",
          payerMask: "masked",
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      code: "syncing",
      message:
        "Payments after 2026-10-15 08:55 UTC are still syncing. Try again in a few minutes.",
    });
    expect(mocks.inserted).toHaveLength(0);
  });

  it("requires a current identity credential", async () => {
    mocks.credentialOk = false;
    await expect(
      issueStatement(
        "did:privy:owner",
        {
          businessId: "biz_1",
          detail: "summary",
          period: "3m",
          payerMask: "masked",
        },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "not_eligible" });
  });
});

describe("records completeness", () => {
  it("returns the time records are complete to", () => {
    expect(
      assertRecordsComplete({ open: true, reasons: [], asOf: RECORDS_AS_OF }),
    ).toBe(RECORDS_AS_OF);
  });

  it("says syncing without a time before the pool index is published", () => {
    expect(() =>
      assertRecordsComplete({
        open: false,
        reasons: ["pool_index_unpublished"],
        asOf: null,
      }),
    ).toThrow(
      "Olio is still syncing your payments. Try again in a few minutes.",
    );
  });

  it("holds statements when records fail a consistency check", () => {
    for (const reason of [
      "pool_index_degraded",
      "pool_roots_mismatch",
      "reconcile_degraded",
    ] as const) {
      expect(() =>
        assertRecordsComplete({
          open: false,
          reasons: ["reconcile_behind", reason],
          asOf: RECORDS_AS_OF,
        }),
      ).toThrow(expect.objectContaining({ code: "records_on_hold" }));
    }
  });
});

describe("statement status", () => {
  it("reports revoked before expired", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    expect(statementStatus({ revokedAt: null, expiresAt: NOW }, past)).toBe(
      "valid",
    );
    expect(statementStatus({ revokedAt: null, expiresAt: past }, NOW)).toBe(
      "expired",
    );
    expect(statementStatus({ revokedAt: past, expiresAt: past }, NOW)).toBe(
      "revoked",
    );
  });
});
