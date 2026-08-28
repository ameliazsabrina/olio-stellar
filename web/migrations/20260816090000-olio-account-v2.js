const LEGACY_INDEXES = ["address_1", "credentialId_unique"];

export async function up(db) {
  const users = db.collection("users");
  const indexes = await users.indexes();

  for (const indexName of LEGACY_INDEXES) {
    if (indexes.some((index) => index.name === indexName)) {
      await users.dropIndex(indexName);
    }
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
