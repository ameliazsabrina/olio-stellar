async function dropIndexIfPresent(collection, indexName) {
  try {
    await collection.dropIndex(indexName);
  } catch (error) {
    if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
  }
}

export async function up(db) {
  await db.collection("users").createIndex(
    { privyWalletAddress: 1 },
    {
      name: "users_privy_wallet_address_unique",
      unique: true,
      sparse: true,
    },
  );
  await db
    .collection("spent_nullifiers")
    .createIndex({ ledger: 1, _id: 1 }, { name: "ledger_id_asc" });
}

export async function down(db) {
  await dropIndexIfPresent(
    db.collection("users"),
    "users_privy_wallet_address_unique",
  );
  await dropIndexIfPresent(db.collection("spent_nullifiers"), "ledger_id_asc");
}
