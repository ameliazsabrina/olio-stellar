async function hasDuplicate(db, collectionName, field) {
  return db
    .collection(collectionName)
    .aggregate([
      { $match: { [field]: { $type: "string" } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    .hasNext();
}

async function dropIndexIfPresent(db, collectionName, indexName) {
  try {
    await db.collection(collectionName).dropIndex(indexName);
  } catch (error) {
    if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
  }
}

export async function up(db) {
  const duplicatePoolQuote = await hasDuplicate(db, "pool_fees", "quoteId");
  const duplicateRelayQuote = await hasDuplicate(db, "cctp_relays", "quoteId");
  const duplicateSettlement = await hasDuplicate(
    db,
    "moneygram_quote_renewals",
    "settlementOperationId",
  );
  if (duplicatePoolQuote || duplicateRelayQuote || duplicateSettlement) {
    throw new Error(
      "Duplicate legacy fee/settlement identifiers must be reconciled before unique indexes are created.",
    );
  }

  await db
    .collection("client_fee_policies")
    .createIndex(
      { state: 1, effectiveAt: 1, expiresAt: 1 },
      { name: "active_effective_policy" },
    );
  await db
    .collection("client_fee_policies")
    .createIndex({ updatedAt: -1 }, { name: "policy_audit_order" });
  await db
    .collection("cctp_relays")
    .createIndex({ state: 1, leaseUntil: 1 }, { name: "relay_state_lease" });
  await db.collection("moneygram_quote_renewals").createIndex(
    { settlementOperationId: 1 },
    {
      name: "moneygram_settlement_operation",
      unique: true,
      partialFilterExpression: { settlementOperationId: { $type: "string" } },
    },
  );
  await db.collection("cctp_relays").createIndex(
    { quoteId: 1 },
    {
      name: "relay_quote_id",
      unique: true,
      partialFilterExpression: { quoteId: { $type: "string" } },
    },
  );
  await db
    .collection("async_fee_quote_contexts")
    .createIndex(
      { expiresAt: 1 },
      { name: "async_quote_expiry", expireAfterSeconds: 0 },
    );
  await db.collection("pool_fees").createIndex(
    { quoteId: 1 },
    {
      name: "fee_quote_id",
      unique: true,
      partialFilterExpression: { quoteId: { $type: "string" } },
    },
  );
}

export async function down(db) {
  await dropIndexIfPresent(db, "pool_fees", "fee_quote_id");
  await dropIndexIfPresent(
    db,
    "moneygram_quote_renewals",
    "moneygram_settlement_operation",
  );
  await dropIndexIfPresent(db, "cctp_relays", "relay_quote_id");
  await dropIndexIfPresent(
    db,
    "async_fee_quote_contexts",
    "async_quote_expiry",
  );
  await dropIndexIfPresent(db, "cctp_relays", "relay_state_lease");
  await dropIndexIfPresent(db, "client_fee_policies", "policy_audit_order");
  await dropIndexIfPresent(
    db,
    "client_fee_policies",
    "active_effective_policy",
  );
}
