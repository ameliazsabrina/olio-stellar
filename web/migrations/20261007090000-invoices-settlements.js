const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const ASYNC_CONTEXT_PATTERN =
  /^async_fee_quote_contexts(?:__([A-Za-z0-9_-]{1,64}))?$/;

export function networkName(env = process.env) {
  return env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE === PUBLIC_PASSPHRASE
    ? "mainnet"
    : "testnet";
}

async function paymentAmountFor(db, scope, quoteId) {
  const suffix = scope ? `__${scope}` : "";
  const session = await db
    .collection(`cctp_sessions${suffix}`)
    .findOne({ quoteId }, { projection: { paymentAmount: 1 } });
  const relay = session
    ? null
    : await db
        .collection(`cctp_relays${suffix}`)
        .findOne({ quoteId }, { projection: { paymentAmount: 1 } });
  const value = session?.paymentAmount ?? relay?.paymentAmount;
  return typeof value === "string" && /^\d{1,19}$/.test(value)
    ? BigInt(value)
    : null;
}

export async function copyAsyncQuoteContexts(db, options = {}) {
  const env = options.env ?? process.env;
  const network = networkName(env);
  const dryRun = options.dryRun === true;
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const summary = { scanned: 0, copied: 0, skipped: 0 };
  for (const { name } of collections) {
    const match = ASYNC_CONTEXT_PATTERN.exec(name);
    if (!match) continue;
    const scope = match[1] ?? null;
    const poolId = scope ?? env.NEXT_PUBLIC_OLIO_POOL_ID ?? null;
    if (!poolId) continue;
    for await (const doc of db.collection(name).find({})) {
      summary.scanned += 1;
      const exists = await db
        .collection("quote_contexts")
        .findOne({ _id: doc._id }, { projection: { _id: 1 } });
      if (exists) {
        summary.skipped += 1;
        continue;
      }
      if (dryRun) {
        summary.copied += 1;
        continue;
      }
      const business = await db
        .collection("business_profiles")
        .findOne({ boundAccount: doc.owner }, { projection: { _id: 1 } });
      const result = await db.collection("quote_contexts").updateOne(
        { _id: doc._id },
        {
          $setOnInsert: {
            _id: doc._id,
            channel: "cctp",
            network,
            poolId,
            recipientOwner: doc.owner,
            businessId: business?._id ?? null,
            notePubkey: doc.notePubkey,
            viewPubkey: doc.viewPubkey,
            commitment: doc.commitment,
            paymentAmount: await paymentAmountFor(db, scope, doc._id),
            intentId: null,
            settlementId: null,
            source: "async_copy",
            createdAt: doc.createdAt ?? new Date(),
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount === 1) summary.copied += 1;
      else summary.skipped += 1;
    }
  }
  return summary;
}

export async function up(db) {
  const invoices = db.collection("invoices");
  await invoices.createIndex(
    { businessId: 1, number: 1 },
    { name: "invoice_business_number", unique: true },
  );
  await invoices.createIndex(
    { businessId: 1, state: 1, number: -1 },
    { name: "invoice_business_state" },
  );

  await db
    .collection("invoice_versions")
    .createIndex(
      { invoiceId: 1, version: 1 },
      { name: "invoice_version_unique", unique: true },
    );
  await db
    .collection("invoice_events")
    .createIndex({ invoiceId: 1, at: 1 }, { name: "invoice_event_time" });

  const intents = db.collection("payment_intents");
  await intents.createIndex(
    { quoteId: 1 },
    { name: "intent_quote_id", unique: true },
  );
  await intents.createIndex(
    { invoiceId: 1, state: 1 },
    { name: "intent_invoice_state" },
  );
  await intents.createIndex(
    { expiresAt: 1 },
    {
      name: "intent_open_expiry",
      expireAfterSeconds: 7 * 86_400,
      partialFilterExpression: { state: "open" },
    },
  );

  await db
    .collection("quote_contexts")
    .createIndex(
      { businessId: 1, createdAt: -1 },
      { name: "quote_context_business" },
    );

  const settlements = db.collection("settlements");
  await settlements.createIndex(
    { network: 1, poolId: 1, leafIndex: 1 },
    { name: "settlement_leaf", unique: true },
  );
  await settlements.createIndex(
    { txHash: 1, eventId: 1 },
    {
      name: "settlement_event",
      unique: true,
      partialFilterExpression: { eventId: { $type: "string" } },
    },
  );
  await settlements.createIndex(
    { businessId: 1, ledgerClosedAt: -1 },
    { name: "settlement_business_time" },
  );
  await settlements.createIndex(
    { businessId: 1, network: 1, poolId: 1, leafIndex: -1 },
    { name: "settlement_business_leaf" },
  );
  await settlements.createIndex(
    { intentId: 1 },
    {
      name: "settlement_intent",
      partialFilterExpression: { intentId: { $type: "string" } },
    },
  );

  const allocations = db.collection("settlement_allocations");
  await allocations.createIndex(
    { invoiceId: 1 },
    { name: "allocation_invoice" },
  );
  await allocations.createIndex(
    { settlementId: 1 },
    { name: "allocation_settlement" },
  );
  await allocations.createIndex(
    { appliedAt: 1, reversedAt: 1, createdAt: 1 },
    { name: "allocation_pending" },
  );

  await db
    .collection("settlement_adjustments")
    .createIndex({ settlementId: 1 }, { name: "adjustment_settlement" });

  await db
    .collection("business_keys")
    .createIndex(
      { businessId: 1, generation: 1 },
      { name: "business_key_generation", unique: true },
    );

  await db
    .collection("evidence_epochs")
    .createIndex(
      { network: 1, poolId: 1, epoch: 1 },
      { name: "evidence_epoch_unique", unique: true },
    );
  await db
    .collection("evidence_leaves")
    .createIndex(
      { businessId: 1, epoch: 1 },
      { name: "evidence_leaf_business_epoch" },
    );

  await copyAsyncQuoteContexts(db);
}

export async function down() {}
