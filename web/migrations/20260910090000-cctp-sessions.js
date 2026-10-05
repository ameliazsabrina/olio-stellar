export async function up(db, explicitScope) {
  const scope = typeof explicitScope === "string" ? explicitScope : process.env.MONGO_POOL_STORAGE_SCOPE;
  if (scope && !/^[A-Za-z0-9_-]{1,64}$/.test(scope)) throw new Error("Invalid pool storage scope");
  const sessions = db.collection(scope ? `cctp_sessions__${scope}` : "cctp_sessions");
  await sessions.createIndex({ network: 1, pool: 1, quoteId: 1 }, { name: "session_quote", unique: true });
  await sessions.createIndex({ network: 1, pool: 1, stage: 1, nextAttemptAt: 1, leaseUntil: 1 }, { name: "session_due" });
  await sessions.createIndex({ network: 1, pool: 1, sourceMessageId: 1 }, { name: "session_message", unique: true, partialFilterExpression: { sourceMessageId: { $type: "string" } } });
  // Only coordination/cache records expire. Unresolved recovery context never does.
  await db.collection("cctp_coordination").createIndex({ expiresAt: 1 }, { name: "coordination_expiry", expireAfterSeconds: 0 });
}
export async function down() {
  // Additive recovery schema must survive application rollback, including its safety indexes.
}
