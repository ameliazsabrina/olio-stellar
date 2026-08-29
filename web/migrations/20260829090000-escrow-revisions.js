export async function up(db) {
  await db.collection("users").updateMany(
    {
      encryptedMaster: { $exists: true },
      masterSalt: { $exists: true },
      kdfParams: { $exists: true },
      escrowRevision: { $exists: false },
    },
    { $set: { escrowRevision: 1 } },
  );
}

export async function down(db) {
  await db
    .collection("users")
    .updateMany(
      { escrowRevision: { $exists: true } },
      { $unset: { escrowRevision: "" } },
    );
}
