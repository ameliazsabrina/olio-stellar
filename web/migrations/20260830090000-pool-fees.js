export async function up(db) {
  const fees = db.collection("pool_fees");
  await fees.createIndex({ txHash: 1 });
  await fees.createIndex({ ledger: 1 });
  await fees.createIndex({ feeRecipient: 1, ledger: 1 });
}

export async function down(db) {
  await db
    .collection("pool_fees")
    .drop()
    .catch(() => undefined);
}
