export async function up(db, explicitScope) {
  const scope =
    typeof explicitScope === "string"
      ? explicitScope
      : process.env.MONGO_POOL_STORAGE_SCOPE;
  if (scope && !/^[A-Za-z0-9_-]{1,64}$/.test(scope))
    throw new Error("Invalid pool storage scope");
  const name = (base) => (scope ? `${base}__${scope}` : base);
  await db
    .collection(name("pool_raw_events"))
    .deleteMany({ goldskyId: { $exists: true } });
  await db
    .collection(name("indexer_state"))
    .deleteMany({ _id: { $in: ["goldsky", "datalake"] } });
}
export async function down() {}
