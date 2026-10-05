import { MongoClient } from "mongodb";
import type {
  BusinessProfileDoc,
  IdentityCredentialDoc,
} from "../src/server/db/mongo";

export const E2E_DATABASE_URI =
  process.env.E2E_MONGODB_URI ?? "mongodb://127.0.0.1:27017/olio_e2e";

export const PUBLISHED_PUBLIC_ID = "pub_e2e_published";
export const SUSPENDED_PUBLIC_ID = "pub_e2e_suspended";
export const UNPUBLISHED_PUBLIC_ID = "pub_e2e_unpublished";
export const STALE_PUBLIC_ID = "pub_e2e_stale";
export const SANDBOX_PUBLIC_ID = "pub_e2e_sandbox";

function profile(
  publicId: string,
  businessId: string,
  displayName: string,
): BusinessProfileDoc {
  const now = new Date();
  return {
    _id: businessId,
    publicId,
    type: "company" as const,
    lifecycle: "active" as const,
    displayName,
    username: null,
    boundAccount: "CE2EACCOUNT",
    boundAt: now,
    createdBy: "did:privy:e2e",
    createdAt: now,
    updatedAt: now,
  };
}

function credentialFor(
  businessId: string,
  overrides: Partial<IdentityCredentialDoc> = {},
): IdentityCredentialDoc {
  const now = new Date();
  return {
    _id: `cred_${businessId}`,
    businessId,
    environment: "live" as const,
    caseId: `case_${businessId}`,
    caseRevision: 2,
    issuer: "olio" as const,
    policyVersion: 1,
    checkedAt: now,
    validUntil: new Date(now.getTime() + 300 * 86_400_000),
    status: "active" as const,
    suspensionReason: null,
    published: true,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export default async function globalSetup(): Promise<void> {
  const client = await new MongoClient(E2E_DATABASE_URI, {
    serverSelectionTimeoutMS: 5000,
  }).connect();
  try {
    const db = client.db();
    const migration = (await import(
      // @ts-expect-error plain ESM production migration
      "../migrations/20260921090000-business-verification.js"
    )) as { up: (database: unknown) => Promise<void> };
    await migration.up(db);
    await db.collection("business_profiles").deleteMany({});
    await db.collection("identity_credentials").deleteMany({});
    await db
      .collection<BusinessProfileDoc>("business_profiles")
      .insertMany([
        profile(PUBLISHED_PUBLIC_ID, "biz_e2e_published", "Warung Verified"),
        profile(SUSPENDED_PUBLIC_ID, "biz_e2e_suspended", "Warung Suspended"),
        profile(UNPUBLISHED_PUBLIC_ID, "biz_e2e_unpublished", "Warung Private"),
        profile(STALE_PUBLIC_ID, "biz_e2e_stale", "Warung Stale"),
        profile(SANDBOX_PUBLIC_ID, "biz_e2e_sandbox", "Warung Sandbox"),
      ]);
    await db
      .collection<IdentityCredentialDoc>("identity_credentials")
      .insertMany([
        credentialFor("biz_e2e_published"),
        credentialFor("biz_e2e_suspended", {
          status: "suspended",
          suspensionReason: "eligibility_declined",
          published: false,
        }),
        credentialFor("biz_e2e_unpublished", {
          published: false,
          publishedAt: null,
        }),
        credentialFor("biz_e2e_stale", {
          checkedAt: new Date(Date.now() - 30 * 86_400_000),
        }),
        credentialFor("biz_e2e_sandbox", { environment: "sandbox" }),
      ]);
  } finally {
    await client.close();
  }
}
