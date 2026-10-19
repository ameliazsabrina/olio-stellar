// Index for the Goldsky pool-event archive, read by ledger range when the
// indexer fills an RPC retention gap.
export async function up(db, explicitScope) {
  const scope =
    typeof explicitScope === "string"
      ? explicitScope
      : process.env.MONGO_POOL_STORAGE_SCOPE;
  if (scope && !/^[A-Za-z0-9_-]{1,64}$/.test(scope))
    throw new Error("Invalid pool storage scope");
  await db
    .collection(scope ? `pool_raw_events__${scope}` : "pool_raw_events")
    .createIndex({ ledger: 1, _id: 1 }, { name: "raw_event_ledger_id" });
}
export async function down() {
  // Additive archive index; keep it across application rollback.
}
