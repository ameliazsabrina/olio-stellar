// Identity Verified badges are retired: owners can no longer hide a published
// badge, so every credential goes back to private and the index that served
// badge lookups is dropped.
export async function up(db) {
  const credentials = db.collection("identity_credentials");
  await credentials.updateMany(
    { published: { $ne: false } },
    { $set: { published: false, publishedAt: null } },
  );
  try {
    await credentials.dropIndex("credential_publication");
  } catch (error) {
    // 26 NamespaceNotFound, 27 IndexNotFound: already gone, so re-runs are safe.
    if (![26, 27].includes(error?.code)) throw error;
  }
}

export async function down(db) {
  // Which badges were published is not restored; owners never had a way to
  // re-publish after the Settings control was removed.
  await db
    .collection("identity_credentials")
    .createIndex(
      { status: 1, published: 1, validUntil: 1 },
      { name: "credential_publication" },
    );
}
