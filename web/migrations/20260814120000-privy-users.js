export async function up(db) {
  await db
    .collection("users")
    .createIndex(
      { privyUserId: 1 },
      { unique: true, sparse: true, name: "users_privy_user_id_unique" },
    );
  await db
    .collection("users")
    .createIndex(
      { privyWalletId: 1 },
      { unique: true, sparse: true, name: "users_privy_wallet_id_unique" },
    );
}

export async function down(db) {
  await db.collection("users").dropIndex("users_privy_wallet_id_unique");
  await db.collection("users").dropIndex("users_privy_user_id_unique");
}
