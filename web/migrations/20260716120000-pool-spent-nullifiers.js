/**
 * Adds the public spent-nullifier mirror used by the asynchronous pool indexer.
 * Existing deposit rows are retained; the worker resets them automatically if
 * the configured pool contract id changes.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collections = await db
    .listCollections({ name: "spent_nullifiers" })
    .toArray();
  if (collections.length === 0) {
    await db.createCollection("spent_nullifiers", {
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["_id", "ledger", "eventId", "txHash", "ts"],
          properties: {
            _id: { bsonType: "string" },
            ledger: { bsonType: "number" },
            eventId: { bsonType: "string" },
            txHash: { bsonType: "string" },
            ts: { bsonType: "date" },
          },
        },
      },
      validationLevel: "moderate",
    });
  }
  for (const collectionName of ["spent_nullifiers", "deposits"]) {
    const collection = db.collection(collectionName);
    const indexes = await collection.indexes();
    const hasLedgerIndex = indexes.some(
      (index) => Object.keys(index.key).length === 1 && index.key.ledger === 1,
    );
    if (!hasLedgerIndex) {
      await collection.createIndex({ ledger: 1 }, { name: "ledger_asc" });
    }
  }
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db
    .collection("deposits")
    .dropIndex("ledger_asc")
    .catch(() => {});
  await db.collection("spent_nullifiers").drop();
};
