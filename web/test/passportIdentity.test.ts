// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessProfileDoc,
  IdentityCredentialDoc,
} from "../src/server/db/mongo";
import {
  buildPreview,
  buildPublicIdentity,
  credentialPublishable,
  publicPathFor,
} from "../src/server/modules/passport/passport.service";
import type { VerificationConfig } from "../src/server/modules/verification/verification.config";
import { CREDENTIAL_STALE_AFTER_MS } from "../src/server/modules/verification/verification.policy";

const NOW = new Date("2026-09-21T12:00:00.000Z");

const sandboxConfig: VerificationConfig = {
  mode: "sandbox",
  environment: "sandbox",
  appToken: "sbx:token",
  secretKey: "secret",
  webhookSecret: "hook",
  webhookAlgorithm: "HMAC_SHA256_HEX",
  levels: { individual: "olio-individual", company: "olio-company" },
  expectedClientId: null,
  timeoutMs: 15_000,
  policyVersion: 1,
  workerEnabled: true,
  operatorIds: [],
  productionRuntime: false,
};

const productionConfig: VerificationConfig = {
  ...sandboxConfig,
  mode: "live",
  environment: "live",
  productionRuntime: true,
};

function business(
  overrides: Partial<BusinessProfileDoc> = {},
): BusinessProfileDoc {
  return {
    _id: "biz_1",
    publicId: "pub_abcdef12",
    type: "company",
    lifecycle: "active",
    displayName: "Kopi Kenangan",
    username: "kopi",
    boundAccount: "CACCOUNT",
    boundAt: NOW,
    createdBy: "did:privy:owner",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function credential(
  overrides: Partial<IdentityCredentialDoc> = {},
): IdentityCredentialDoc {
  return {
    _id: "cred_1",
    businessId: "biz_1",
    environment: "sandbox",
    caseId: "case_1",
    caseRevision: 4,
    issuer: "olio",
    policyVersion: 1,
    checkedAt: new Date(NOW.getTime() - 3_600_000),
    validUntil: new Date(NOW.getTime() + 300 * 86_400_000),
    status: "active",
    suspensionReason: null,
    published: true,
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("public projection allowlist", () => {
  it("exposes only the identity claim fields", () => {
    const identity = buildPublicIdentity(
      business(),
      credential(),
      sandboxConfig,
      NOW,
    );
    expect(Object.keys(identity ?? {}).sort()).toEqual([
      "checkedAt",
      "displayName",
      "issuer",
      "policyVersion",
      "publicId",
      "scope",
      "type",
      "validUntil",
      "verified",
    ]);
    expect(identity?.scope).toBe("identity");
    expect(identity?.issuer).toBe("olio");
  });

  it("never leaks case ids, applicant ids, usernames, accounts or reject reasons", () => {
    const serialized = JSON.stringify(
      buildPublicIdentity(business(), credential(), sandboxConfig, NOW),
    );
    for (const secret of [
      "case_1",
      "biz_1",
      "kopi",
      "CACCOUNT",
      "did:privy:owner",
      "cred_1",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("uses the opaque public id in the shareable path", () => {
    expect(publicPathFor("pub_abcdef12")).toBe("/business/pub_abcdef12");
  });
});

describe("consent", () => {
  it("returns nothing while the badge is unpublished", () => {
    expect(
      buildPublicIdentity(
        business(),
        credential({ published: false }),
        sandboxConfig,
        NOW,
      ),
    ).toBeNull();
  });

  it("returns nothing when there is no credential at all", () => {
    expect(
      buildPublicIdentity(business(), null, sandboxConfig, NOW),
    ).toBeNull();
  });

  it("hides the public path in the private preview until the badge is published", () => {
    const unpublished = buildPreview(
      business(),
      credential({ published: false }),
      sandboxConfig,
      NOW,
    );
    expect(unpublished.publishable).toBe(true);
    expect(unpublished.publicPath).toBeNull();
    const published = buildPreview(
      business(),
      credential(),
      sandboxConfig,
      NOW,
    );
    expect(published.publicPath).toBe("/business/pub_abcdef12");
  });
});

describe("suspension, expiry and staleness", () => {
  it("withdraws a suspended badge from the public projection", () => {
    expect(
      buildPublicIdentity(
        business(),
        credential({
          status: "suspended",
          suspensionReason: "eligibility_declined",
        }),
        sandboxConfig,
        NOW,
      ),
    ).toBeNull();
  });

  it("withdraws an expired badge", () => {
    expect(
      buildPublicIdentity(
        business(),
        credential({ validUntil: new Date(NOW.getTime() - 1) }),
        sandboxConfig,
        NOW,
      ),
    ).toBeNull();
  });

  it("withdraws a badge whose evidence has gone stale", () => {
    expect(
      buildPublicIdentity(
        business(),
        credential({
          checkedAt: new Date(NOW.getTime() - CREDENTIAL_STALE_AFTER_MS - 1),
        }),
        sandboxConfig,
        NOW,
      ),
    ).toBeNull();
  });

  it("withdraws the badge of a suspended or closed business", () => {
    for (const lifecycle of ["suspended", "closed"] as const) {
      expect(
        buildPublicIdentity(
          business({ lifecycle }),
          credential(),
          sandboxConfig,
          NOW,
        ),
      ).toBeNull();
      expect(
        buildPreview(business({ lifecycle }), credential(), sandboxConfig, NOW)
          .publishable,
      ).toBe(false);
    }
  });

  it("reports the private preview status as expired rather than active", () => {
    const preview = buildPreview(
      business(),
      credential({ validUntil: new Date(NOW.getTime() - 1) }),
      sandboxConfig,
      NOW,
    );
    expect(preview.credential?.status).toBe("expired");
    expect(preview.credential?.published).toBe(false);
    expect(preview.publishable).toBe(false);
  });
});

describe("environment separation", () => {
  it("never publishes a sandbox credential from a production deployment", () => {
    expect(
      credentialPublishable(
        credential({ environment: "sandbox" }),
        productionConfig,
        NOW,
      ),
    ).toBe(false);
    expect(
      buildPublicIdentity(
        business(),
        credential({ environment: "sandbox" }),
        productionConfig,
        NOW,
      ),
    ).toBeNull();
  });

  it("publishes a live credential from a production deployment", () => {
    expect(
      credentialPublishable(
        credential({ environment: "live" }),
        productionConfig,
        NOW,
      ),
    ).toBe(true);
  });

  it("ignores a credential issued in another environment", () => {
    expect(
      credentialPublishable(
        credential({ environment: "live" }),
        sandboxConfig,
        NOW,
      ),
    ).toBe(false);
  });

  it("publishes nothing when verification is disabled entirely", () => {
    const off = { ...sandboxConfig, mode: "off" as const, environment: null };
    expect(credentialPublishable(credential(), off, NOW)).toBe(false);
  });
});
