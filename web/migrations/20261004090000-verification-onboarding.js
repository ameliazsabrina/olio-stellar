// Deploy before the worker/web release that enforces submission.
export async function up(db) {
  await db.collection("business_profiles").createIndex(
    { boundAccount: 1 },
    {
      name: "business_bound_account",
      unique: true,
      partialFilterExpression: { boundAccount: { $type: "string" } },
    },
  );
  const cases = db.collection("verification_cases");
  await cases.createIndex(
    { "notificationOutbox.0": 1 },
    { name: "case_notification_delivery" },
  );
  await db
    .collection("notifications")
    .createIndex(
      { businessId: 1, environment: 1, at: -1, _id: -1 },
      { name: "notification_inbox" },
    );
  await db
    .collection("notifications")
    .createIndex(
      { businessId: 1, environment: 1, readBy: 1 },
      { name: "notification_unread" },
    );
  for await (const doc of cases.find({})) {
    const snapshot = doc.snapshot;
    const evidence =
      snapshot &&
      snapshot.sandboxMode === (doc.environment === "sandbox") &&
      snapshot.applicantType === doc.applicantType &&
      (!snapshot.levelName || snapshot.levelName === doc.levelName) &&
      [
        "pending",
        "prechecked",
        "queued",
        "awaitingService",
        "onHold",
        "completed",
      ].includes(snapshot.reviewStatus);
    // Use the time evidence was observed, never applicant creation or an SDK event.
    const event = doc.applicantId
      ? await db.collection("verification_events").findOne(
          {
            provider: "sumsub",
            environment: doc.environment,
            applicantId: doc.applicantId,
            type: {
              $in: ["applicantPending", "applicantReviewed", "applicantOnHold"],
            },
            state: "done",
          },
          { sort: { receivedAt: 1 } },
        )
      : null;
    const firstSubmittedAt =
      doc.firstSubmittedAt ??
      event?.receivedAt ??
      (evidence ? (doc.providerCheckedAt ?? null) : null);
    const seedId = `${doc._id}:current-status`;
    await cases.updateOne({ _id: doc._id }, [
      {
        $set: {
          firstSubmittedAt: {
            $ifNull: ["$firstSubmittedAt", firstSubmittedAt],
          },
          notificationOutbox: {
            $cond: [
              {
                $in: [
                  seedId,
                  {
                    $map: {
                      input: { $ifNull: ["$notificationOutbox", []] },
                      as: "item",
                      in: "$$item.id",
                    },
                  },
                ],
              },
              "$notificationOutbox",
              {
                $concatArrays: [
                  { $ifNull: ["$notificationOutbox", []] },
                  [{ id: seedId, kind: "$eligibility", at: "$updatedAt" }],
                ],
              },
            ],
          },
        },
      },
    ]);
  }
}
export async function down(db) {
  // Keep durable submission history and delivered notifications on rollback.
  await db.collection("business_profiles").dropIndex("business_bound_account");
  await db
    .collection("verification_cases")
    .dropIndex("case_notification_delivery");
  await db.collection("notifications").dropIndex("notification_inbox");
  await db.collection("notifications").dropIndex("notification_unread");
}
