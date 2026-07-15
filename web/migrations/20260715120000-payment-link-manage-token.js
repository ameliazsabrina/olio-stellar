/**
 * Adds the per-link manage capability token hash to the payment_links validator.
 * Optional field, so pre-existing (tokenless) links stay valid but unmanageable
 * via the API. No backfill — legacy links are intentionally left tokenless.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.command({
    collMod: "payment_links",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "_id",
          "owner",
          "slug",
          "amount",
          "description",
          "label",
          "state",
          "status",
          "createdAt",
        ],
        properties: {
          _id: { bsonType: "string" },
          owner: { bsonType: "string" },
          slug: { bsonType: "string" },
          amount: { bsonType: ["string", "null"] },
          description: { bsonType: ["string", "null"] },
          label: { bsonType: ["string", "null"] },
          state: { enum: ["active", "archived"] },
          status: { enum: ["pending", "paid"] },
          manageTokenHash: { bsonType: ["string", "null"] },
          createdAt: { bsonType: "date" },
          updatedAt: { bsonType: "date" },
          archivedAt: { bsonType: ["date", "null"] },
        },
      },
    },
    validationLevel: "moderate",
  });
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const links = db.collection("payment_links");
  await db.command({
    collMod: "payment_links",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "_id",
          "owner",
          "slug",
          "amount",
          "description",
          "label",
          "state",
          "status",
          "createdAt",
        ],
        properties: {
          _id: { bsonType: "string" },
          owner: { bsonType: "string" },
          slug: { bsonType: "string" },
          amount: { bsonType: ["string", "null"] },
          description: { bsonType: ["string", "null"] },
          label: { bsonType: ["string", "null"] },
          state: { enum: ["active", "archived"] },
          status: { enum: ["pending", "paid"] },
          createdAt: { bsonType: "date" },
          updatedAt: { bsonType: "date" },
          archivedAt: { bsonType: ["date", "null"] },
        },
      },
    },
    validationLevel: "moderate",
  });
  await links.updateMany({}, { $unset: { manageTokenHash: "" } });
};
