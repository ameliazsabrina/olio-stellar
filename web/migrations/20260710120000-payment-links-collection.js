/**
 * payment_links: payee-generated shareable links (Receive Fund, Phase 1). Holds
 * only link metadata — owner username, requested amount, label — never note
 * contents or any commitment/recipient linkage. amount is a base-units decimal
 * string (null = open amount). status is "pending"/"paid"; v1 only writes
 * "pending" and detects receipt client-side.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.createCollection("payment_links", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "owner", "amount", "label", "status", "createdAt"],
        properties: {
          _id: { bsonType: "string" },
          owner: { bsonType: "string" },
          amount: { bsonType: ["string", "null"] },
          label: { bsonType: ["string", "null"] },
          status: { enum: ["pending", "paid"] },
          createdAt: { bsonType: "date" },
        },
      },
    },
    validationLevel: "moderate",
  });
  await db
    .collection("payment_links")
    .createIndex({ owner: 1, createdAt: -1 }, { name: "owner_createdAt" });
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection("payment_links").drop();
};
