const LEGACY_INDEXES = ["address_1", "credentialId_unique"];

export async function up(db) {
  const users = db.collection("users");
  const indexes = await users.indexes();
  const names = new Set(indexes.map((index) => index.name));

  for (const indexName of LEGACY_INDEXES) {
    if (names.has(indexName)) await users.dropIndex(indexName);
  }
}

export async function down() {
  // Privy-era user documents do not contain the legacy indexed fields, so
  // recreating these non-sparse unique indexes would make inserts conflict.
}
