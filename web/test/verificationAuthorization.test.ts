// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessMembershipDoc,
  BusinessProfileDoc,
  IdentityCredentialDoc,
  VerificationCaseDoc,
} from "../src/server/db/mongo";

const mocks = vi.hoisted(() => ({
  profiles: [] as BusinessProfileDoc[],
  memberships: [] as BusinessMembershipDoc[],
  cases: [] as VerificationCaseDoc[],
  credentials: [] as IdentityCredentialDoc[],
  audit: [] as Record<string, unknown>[],
  wallet: vi.fn(),
  usernameByOwner: vi.fn(),
  client: {
    ensureApplicant: vi.fn(),
    createSdkToken: vi.fn(),
    snapshot: vi.fn(),
  },
}));

function matches(
  doc: Record<string, unknown>,
  filter: Record<string, unknown>,
) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or" || key === "$and") return true;
    if (value && typeof value === "object" && "$in" in (value as object)) {
      return (value as { $in: unknown[] }).$in.includes(doc[key]);
    }
    return doc[key] === value;
  });
}

function collection<T extends { _id: string }>(rows: T[]) {
  return {
    async findOne(filter: Record<string, unknown>) {
      return rows.find((row) => matches(row, filter)) ?? null;
    },
    find(filter: Record<string, unknown>) {
      const selected = rows.filter((row) => matches(row, filter));
      return {
        sort: () => ({
          limit: () => ({ toArray: async () => selected }),
          toArray: async () => selected,
        }),
        limit: () => ({ toArray: async () => selected }),
        toArray: async () => selected,
      };
    },
    async insertOne(doc: T) {
      if (rows.some((row) => row._id === doc._id)) {
        throw Object.assign(new Error("dup"), { code: 11000 });
      }
      rows.push(doc);
      return { acknowledged: true };
    },
    async deleteOne(filter: Record<string, unknown>) {
      const index = rows.findIndex((row) => matches(row, filter));
      if (index >= 0) rows.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    async findOneAndUpdate(
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) {
      const row = rows.find((candidate) => matches(candidate, filter));
      if (!row) return null;
      Object.assign(row, update.$set ?? {});
      for (const [key, value] of Object.entries(update.$inc ?? {})) {
        (row as Record<string, unknown>)[key] =
          ((row as Record<string, number>)[key] ?? 0) + (value as number);
      }
      for (const key of Object.keys(update.$unset ?? {})) {
        delete (row as Record<string, unknown>)[key];
      }
      return row;
    },
    async updateMany(
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) {
      const selected = rows.filter((row) => matches(row, filter));
      for (const row of selected) {
        Object.assign(row, update.$set ?? {});
        for (const [key, value] of Object.entries(update.$push ?? {})) {
          const current = (row as Record<string, unknown[]>)[key] ?? [];
          (row as Record<string, unknown[]>)[key] = [...current, value];
        }
        for (const [key, value] of Object.entries(update.$inc ?? {})) {
          (row as Record<string, number>)[key] =
            ((row as Record<string, number>)[key] ?? 0) + (value as number);
        }
      }
      return { matchedCount: selected.length, modifiedCount: selected.length };
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) {
      const row = rows.find((candidate) => matches(candidate, filter));
      if (row) Object.assign(row, update.$set ?? {});
      return { matchedCount: row ? 1 : 0 };
    },
    async countDocuments(filter: Record<string, unknown>) {
      return rows.filter((row) => matches(row, filter)).length;
    },
  };
}

vi.mock("../src/server/db/mongo", () => ({
  getBusinessProfiles: async () => collection(mocks.profiles),
  getBusinessMemberships: async () => collection(mocks.memberships),
  getVerificationCases: async () => collection(mocks.cases),
  getIdentityCredentials: async () => collection(mocks.credentials),
  getVerificationAudit: async () => collection(mocks.audit as never[]),
  getVerificationEvents: async () => collection([]),
  getVerificationCoordination: async () => ({
    async findOneAndUpdate() {
      return { _id: "budget", count: 1 };
    },
    async findOne() {
      return null;
    },
    async updateOne() {
      return { matchedCount: 1 };
    },
  }),
  getDb: async () => ({
    collection: () => ({ listIndexes: () => ({ toArray: async () => [] }) }),
  }),
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: mocks.wallet,
}));
vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  usernameByOwner: mocks.usernameByOwner,
}));
vi.mock("../src/server/modules/verification/sumsub.client", () => ({
  configuredSumsubClient: () => mocks.client,
}));

import {
  BusinessBindingError,
  BusinessForbiddenError,
  BusinessNotFoundError,
} from "../src/server/modules/businesses/businesses.errors";
import {
  bindAccount,
  businessOwnsUsername,
  createBusiness,
  listMine,
  updateProfile,
} from "../src/server/modules/businesses/businesses.service";
import {
  identityPreview,
  setVisibility,
} from "../src/server/modules/passport/passport.service";
import type { VerificationConfig } from "../src/server/modules/verification/verification.config";
import { VerificationStateError } from "../src/server/modules/verification/verification.errors";
import {
  isOperator,
  issueSdkToken,
  listCasesForOperator,
  startVerification,
  verificationStatus,
} from "../src/server/modules/verification/verification.service";

const OWNER = "did:privy:owner";
const OUTSIDER = "did:privy:outsider";

const config: VerificationConfig = {
  mode: "sandbox",
  environment: "sandbox",
  appToken: "sbx:token",
  secretKey: "secret",
  webhookSecret: "hook",
  webhookAlgorithm: "HMAC_SHA256_HEX",
  levels: { individual: "olio-individual", company: "olio-company" },
  expectedClientId: "olio",
  timeoutMs: 15_000,
  policyVersion: 1,
  workerEnabled: true,
  operatorIds: ["did:privy:operator"],
  productionRuntime: false,
};

async function seedBusiness(type: "individual" | "company" = "individual") {
  mocks.wallet.mockResolvedValue({
    contractId: "CACCOUNT",
    privyWalletId: "w1",
    privyWalletAddress: "GADDR",
  });
  mocks.usernameByOwner.mockResolvedValue("alice");
  return createBusiness(OWNER, { type, displayName: "Alice Co" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.length = 0;
  mocks.memberships.length = 0;
  mocks.cases.length = 0;
  mocks.credentials.length = 0;
  mocks.audit.length = 0;
  mocks.client.ensureApplicant.mockResolvedValue({
    applicantId: "app_1",
    created: true,
  });
  mocks.client.createSdkToken.mockResolvedValue({
    token: "sdk-token",
    ttlInSecs: 600,
  });
});

describe("cross-account access", () => {
  it("does not reveal another account's business through mine", async () => {
    await seedBusiness();
    expect(await listMine(OUTSIDER)).toEqual([]);
    expect((await listMine(OWNER)).map((b) => b.role)).toEqual(["owner"]);
  });

  it("refuses status, start, token and passport reads for a non-member", async () => {
    const business = await seedBusiness();
    for (const call of [
      () => verificationStatus(OUTSIDER, business.businessId, config),
      () => startVerification(OUTSIDER, business.businessId, { config }),
      () => issueSdkToken(OUTSIDER, business.businessId, { config }),
      () => identityPreview(OUTSIDER, business.businessId, config),
      () => setVisibility(OUTSIDER, business.businessId, true, config),
      () =>
        updateProfile(OUTSIDER, {
          businessId: business.businessId,
          displayName: "x",
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(BusinessNotFoundError);
    }
  });

  it("refuses a guessed business id", async () => {
    await expect(
      verificationStatus(OWNER, "biz_does_not_exist", config),
    ).rejects.toBeInstanceOf(BusinessNotFoundError);
  });

  it("refuses management by a plain member", async () => {
    const business = await seedBusiness();
    mocks.memberships.push({
      _id: `${business.businessId}:member`,
      businessId: business.businessId,
      privyUserId: "did:privy:member",
      role: "member",
      createdAt: new Date(),
    });
    await expect(
      startVerification("did:privy:member", business.businessId, { config }),
    ).rejects.toBeInstanceOf(BusinessForbiddenError);
    await expect(
      verificationStatus("did:privy:member", business.businessId, config),
    ).resolves.toMatchObject({ eligibility: "not_started" });
  });
});

describe("applicant and level injection", () => {
  it("derives the external id and level from the server, never the caller", async () => {
    const business = await seedBusiness("company");
    await startVerification(OWNER, business.businessId, { config });
    const [args] = mocks.client.ensureApplicant.mock.calls[0];
    expect(args.levelName).toBe("olio-company");
    expect(args.type).toBe("company");
    expect(args.externalUserId).toMatch(/^olio-sandbox-[0-9a-f]{32}$/);
    expect(args.externalUserId).not.toContain("alice");
    expect(args.externalUserId).not.toContain("CACCOUNT");
    expect(args.externalUserId).not.toContain(business.businessId);
  });

  it("issues SDK tokens only for the stored applicant of an existing case", async () => {
    const business = await seedBusiness();
    await expect(
      issueSdkToken(OWNER, business.businessId, { config }),
    ).rejects.toMatchObject({ code: "no_case" });
    await startVerification(OWNER, business.businessId, { config });
    await issueSdkToken(OWNER, business.businessId, { config });
    const [tokenArgs] = mocks.client.createSdkToken.mock.calls[0];
    expect(tokenArgs.externalUserId).toBe(mocks.cases[0].externalUserId);
    expect(tokenArgs.levelName).toBe("olio-individual");
  });

  it("reuses one case per business and environment instead of creating another applicant", async () => {
    const business = await seedBusiness();
    await startVerification(OWNER, business.businessId, { config });
    await startVerification(OWNER, business.businessId, { config });
    expect(mocks.cases).toHaveLength(1);
    expect(mocks.client.ensureApplicant).toHaveBeenCalledTimes(1);
  });
});

describe("username binding", () => {
  it("refuses to start verification before the account is linked", async () => {
    mocks.wallet.mockResolvedValue(null);
    mocks.usernameByOwner.mockResolvedValue(null);
    const business = await createBusiness(OWNER, {
      type: "individual",
      displayName: null,
    });
    await expect(
      startVerification(OWNER, business.businessId, { config }),
    ).rejects.toMatchObject({ code: "not_bound" });
  });

  it("binds only the account the registry actually attributes to the owner", async () => {
    mocks.wallet.mockResolvedValue(null);
    mocks.usernameByOwner.mockResolvedValue(null);
    const business = await createBusiness(OWNER, {
      type: "individual",
      displayName: null,
    });
    expect(business.accountBound).toBe(false);
    mocks.wallet.mockResolvedValue({
      contractId: "CACCOUNT",
      privyWalletId: "w1",
      privyWalletAddress: "GADDR",
    });
    mocks.usernameByOwner.mockResolvedValue("alice");
    const bound = await bindAccount(OWNER, business.businessId);
    expect(bound.changed).toBe(true);
    expect(bound.business.username).toBe("alice");
  });

  it("does not let a claimed username be asserted without registry agreement", async () => {
    const business = await seedBusiness();
    expect(
      await businessOwnsUsername(OWNER, business.businessId, "alice"),
    ).toBe(true);
    expect(
      await businessOwnsUsername(OWNER, business.businessId, "mallory"),
    ).toBe(false);
    mocks.usernameByOwner.mockResolvedValue("someone-else");
    expect(
      await businessOwnsUsername(OWNER, business.businessId, "alice"),
    ).toBe(false);
  });

  it("suspends an approved credential when the linked account changes", async () => {
    const business = await seedBusiness();
    await startVerification(OWNER, business.businessId, { config });
    mocks.cases[0].eligibility = "approved";
    mocks.credentials.push({
      _id: "cred_1",
      businessId: business.businessId,
      environment: "sandbox",
      caseId: mocks.cases[0]._id,
      caseRevision: 1,
      issuer: "olio",
      policyVersion: 1,
      checkedAt: new Date(),
      validUntil: new Date(Date.now() + 86_400_000),
      status: "active",
      suspensionReason: null,
      published: true,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.wallet.mockResolvedValue({
      contractId: "CNEWACCOUNT",
      privyWalletId: "w2",
      privyWalletAddress: "GNEW",
    });
    mocks.usernameByOwner.mockResolvedValue("alice2");
    await bindAccount(OWNER, business.businessId);
    expect(mocks.credentials[0]).toMatchObject({
      status: "suspended",
      published: false,
      suspensionReason: "ownership_changed",
    });
    expect(mocks.cases[0].eligibility).toBe("manual_review");
  });

  it("reports a registry outage as a binding error rather than an unbound account", async () => {
    mocks.wallet.mockResolvedValue({
      contractId: "CACCOUNT",
      privyWalletId: "w1",
      privyWalletAddress: "GADDR",
    });
    mocks.usernameByOwner.mockRejectedValue(new Error("registry down"));
    await expect(
      createBusiness(OWNER, { type: "individual", displayName: null }),
    ).rejects.toBeInstanceOf(BusinessBindingError);
  });
});

describe("operator restrictions", () => {
  it("only recognizes explicitly configured operator identities", () => {
    expect(isOperator("did:privy:operator", config)).toBe(true);
    expect(isOperator(OWNER, config)).toBe(false);
    expect(isOperator("", config)).toBe(false);
  });

  it("refuses the operator case list to ordinary users", async () => {
    await expect(
      listCasesForOperator(OWNER, { limit: 10 }, config),
    ).rejects.toBeInstanceOf(VerificationStateError);
    await expect(
      listCasesForOperator("did:privy:operator", { limit: 10 }, config),
    ).resolves.toEqual([]);
  });

  it("gives operators sanitized summaries without applicant identifiers", async () => {
    const business = await seedBusiness();
    await startVerification(OWNER, business.businessId, { config });
    const [summary] = await listCasesForOperator(
      "did:privy:operator",
      { limit: 10 },
      config,
    );
    expect(summary.caseId).toBe(mocks.cases[0]._id);
    expect(Object.keys(summary)).not.toContain("externalUserId");
    expect(Object.keys(summary)).not.toContain("applicantId");
    expect(Object.keys(summary)).not.toContain("snapshot");
  });
});

describe("disabled deployments", () => {
  const offConfig: VerificationConfig = {
    ...config,
    mode: "off",
    environment: null,
  };

  it("reports a safe status and refuses to start when verification is off", async () => {
    const business = await seedBusiness();
    const status = await verificationStatus(
      OWNER,
      business.businessId,
      offConfig,
    );
    expect(status).toMatchObject({
      mode: "off",
      eligibility: "not_started",
      canStart: false,
      nextAction: "wait",
    });
    await expect(
      startVerification(OWNER, business.businessId, { config: offConfig }),
    ).rejects.toThrow(/not available/);
    expect(mocks.client.ensureApplicant).not.toHaveBeenCalled();
  });
});
