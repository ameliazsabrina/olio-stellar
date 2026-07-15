/**
 * Adds managed payment link fields for clean URLs and archived state while
 * keeping existing id-based links valid.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const links = db.collection("payment_links");
  const cursor = links.find({});

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;
    const now = doc.updatedAt || doc.createdAt || new Date();
    await links.updateOne(
      { _id: doc._id },
      {
        $set: {
          slug: doc.slug || doc._id,
          description:
            doc.description === undefined ? doc.label || null : doc.description,
          label: doc.label === undefined ? doc.description || null : doc.label,
          state: doc.state || "active",
          updatedAt: now,
          archivedAt: doc.archivedAt === undefined ? null : doc.archivedAt,
        },
      },
    );
  }

  await links.createIndex(
    { owner: 1, slug: 1 },
    { name: "owner_slug_unique", unique: true },
  );
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
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const links = db.collection("payment_links");
  await links.dropIndex("owner_slug_unique");
  await db.command({
    collMod: "payment_links",
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
  await links.updateMany(
    {},
    {
      $unset: {
        slug: "",
        description: "",
        state: "",
        updatedAt: "",
        archivedAt: "",
      },
    },
  );
};
