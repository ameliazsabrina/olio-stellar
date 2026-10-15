// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  BusinessProfileDoc,
  IdentityCredentialDoc,
} from "../src/server/db/mongo";
import * as passportService from "../src/server/modules/passport/passport.service";
import { buildPreview } from "../src/server/modules/passport/passport.service";

const NOW = new Date("2026-09-21T12:00:00.000Z");

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
    published: false,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("identity badges are retired", () => {
  it("no longer exports any way to publish or look up a public badge", () => {
    for (const name of [
      "setVisibility",
      "publicIdentity",
      "buildPublicIdentity",
      "publishedPublicIdsFor",
      "publicPathFor",
      "credentialPublishable",
    ]) {
      expect(passportService).not.toHaveProperty(name);
    }
  });

  it("returns a private preview with no public link or publish state", () => {
    const preview = buildPreview(business(), credential(), NOW);
    expect(Object.keys(preview).sort()).toEqual([
      "businessId",
      "credential",
      "displayName",
      "publicId",
      "type",
    ]);
    expect(preview.credential?.status).toBe("active");
  });

  it("never reports a legacy published flag as published", () => {
    const preview = buildPreview(
      business(),
      credential({ validUntil: new Date(NOW.getTime() - 1), published: true }),
      NOW,
    );
    expect(preview.credential?.status).toBe("expired");
    expect(preview.credential?.published).toBe(false);
  });

  it("reports no credential when verification has not issued one", () => {
    expect(buildPreview(business(), null, NOW).credential).toBeNull();
  });
});
