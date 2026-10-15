// Statements hold digests and totals only; payment rows never reach the database.
export async function up(db) {
  await db
    .collection("passport_statements")
    .createIndex(
      { businessId: 1, issuedAt: -1 },
      { name: "passport_statements_by_business" },
    );
}

export async function down(db) {
  // Keep issued statements so verify links keep answering after a rollback.
  await db
    .collection("passport_statements")
    .dropIndex("passport_statements_by_business");
}
