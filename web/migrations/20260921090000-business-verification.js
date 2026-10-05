export async function up(db) {
  const profiles = db.collection("business_profiles");
  await profiles.createIndex(
    { publicId: 1 },
    { name: "business_public_id", unique: true },
  );
  await profiles.createIndex(
    { username: 1 },
    {
      name: "business_username",
      unique: true,
      partialFilterExpression: { username: { $type: "string" } },
    },
  );
  await profiles.createIndex({ createdBy: 1 }, { name: "business_created_by" });

  const memberships = db.collection("business_memberships");
  await memberships.createIndex(
    { businessId: 1, privyUserId: 1 },
    { name: "membership_business_user", unique: true },
  );
  await memberships.createIndex(
    { privyUserId: 1 },
    { name: "membership_user" },
  );

  const cases = db.collection("verification_cases");
  await cases.createIndex(
    { provider: 1, environment: 1, externalUserId: 1 },
    { name: "case_external_user", unique: true },
  );
  await cases.createIndex(
    { provider: 1, environment: 1, applicantId: 1 },
    {
      name: "case_applicant",
      unique: true,
      partialFilterExpression: { applicantId: { $type: "string" } },
    },
  );
  await cases.createIndex(
    { businessId: 1, provider: 1, environment: 1 },
    { name: "case_business_environment", unique: true },
  );
  await cases.createIndex(
    { reconcileAt: 1, leaseUntil: 1 },
    { name: "case_reconcile_due" },
  );

  const events = db.collection("verification_events");
  await events.createIndex(
    { state: 1, nextAttemptAt: 1, leaseUntil: 1 },
    { name: "event_due" },
  );
  await events.createIndex(
    { provider: 1, environment: 1, externalUserId: 1, receivedAt: -1 },
    { name: "event_external_user" },
  );

  const audit = db.collection("verification_audit");
  await audit.createIndex(
    { businessId: 1, at: -1 },
    { name: "audit_business_time" },
  );
  await audit.createIndex({ caseId: 1, at: -1 }, { name: "audit_case_time" });

  const credentials = db.collection("identity_credentials");
  await credentials.createIndex(
    { businessId: 1, environment: 1 },
    { name: "credential_business_environment", unique: true },
  );
  await credentials.createIndex(
    { status: 1, published: 1, validUntil: 1 },
    { name: "credential_publication" },
  );

  await db
    .collection("verification_coordination")
    .createIndex(
      { expiresAt: 1 },
      { name: "verification_coordination_expiry", expireAfterSeconds: 0 },
    );

  await db.collection("payment_links").createIndex(
    { businessId: 1 },
    {
      name: "payment_link_business",
      partialFilterExpression: { businessId: { $type: "string" } },
    },
  );
}

export async function down() {}
