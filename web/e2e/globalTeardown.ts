import { MongoClient } from "mongodb";
import { E2E_DATABASE_URI } from "./globalSetup";

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATA === "1") return;
  const client = await new MongoClient(E2E_DATABASE_URI, {
    serverSelectionTimeoutMS: 5000,
  }).connect();
  try {
    const db = client.db();
    await db.collection("business_profiles").deleteMany({
      createdBy: "did:privy:e2e",
    });
    await db.collection("identity_credentials").deleteMany({
      businessId: { $regex: "^biz_e2e_" },
    });
  } finally {
    await client.close();
  }
}
