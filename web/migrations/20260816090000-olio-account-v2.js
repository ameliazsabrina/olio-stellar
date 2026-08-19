export async function up(db) {
  const users = db.collection("users");
  const indexes = await users.indexes();
  if (indexes.some((index) => index.name === "credentialId_unique")) {
    await users.dropIndex("credentialId_unique");
  }
  await users.updateMany(
    {},
    {
      $unset: {
        address: "",
        contractId: "",
        credentialId: "",
        secp256r1PubKey: "",
        migrationState: "",
        privySignerVerifiedAt: "",
        migratedAt: "",
      },
    },
  );
}

export async function down() {
  // Destructive cleanup cannot reconstruct legacy authentication material.
}
