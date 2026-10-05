export async function up(db, explicitScope) {
  const scope =
    typeof explicitScope === "string"
      ? explicitScope
      : process.env.MONGO_POOL_STORAGE_SCOPE;
  if (scope && !/^[A-Za-z0-9_-]{1,64}$/.test(scope))
    throw new Error("Invalid pool storage scope");
  const sessions = db.collection(
    scope ? `fiat_sessions__${scope}` : "fiat_sessions",
  );
  await sessions.createIndex(
    { network: 1, pool: 1, state: 1, nextAttemptAt: 1, leaseUntil: 1 },
    { name: "fiat_session_due" },
  );
  await sessions.createIndex(
    { network: 1, pool: 1, "durianpay.paymentId": 1 },
    {
      name: "fiat_session_payment",
      unique: true,
      partialFilterExpression: { "durianpay.paymentId": { $type: "string" } },
    },
  );
  await sessions.createIndex(
    { network: 1, pool: 1, "durianpay.orderId": 1 },
    {
      name: "fiat_session_order",
      unique: true,
      partialFilterExpression: { "durianpay.orderId": { $type: "string" } },
    },
  );
  await sessions.createIndex(
    { network: 1, pool: 1, createdAt: 1 },
    { name: "fiat_session_created" },
  );
  await db
    .collection("fiat_coordination")
    .createIndex(
      { expiresAt: 1 },
      { name: "coordination_expiry", expireAfterSeconds: 0 },
    );
}
export async function down() {}
