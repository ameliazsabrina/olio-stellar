/**
 * Passkey smart-wallet accounts: look up a user by their WebAuthn credential id
 * during login. Sparse so legacy Privy users (no credentialId) don't collide.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db
    .collection("users")
    .createIndex(
      { credentialId: 1 },
      { unique: true, sparse: true, name: "credentialId_unique" },
    );
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection("users").dropIndex("credentialId_unique");
};
