import { randomUUID } from "node:crypto";
import { Binary, type Db, MongoClient } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    db: null as Db | null,
    resolve: vi.fn(),
    notify: vi.fn(),
    database(): Db {
      if (!state.db) throw new Error("Test database is not connected.");
      return state.db;
    },
  };
  return state;
});

vi.mock("../src/server/db/mongo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/db/mongo")>();
  const collection =
    (name: string, useBigInt64 = false) =>
    async () =>
      mocks
        .database()
        .collection(name, useBigInt64 ? { useBigInt64: true } : {});
  return {
    ...actual,
    getDb: async () => mocks.database(),
    getDeposits: collection("deposits"),
    getFees: collection("pool_fees"),
    getIndexerState: collection("indexer_state"),
    getWithdrawals: collection("withdrawals", true),
    getPoolRoots: collection("pool_roots"),
    getCctpSessions: collection("cctp_sessions"),
    getCctpRelays: collection("cctp_relays"),
    getInvoices: collection("invoices", true),
    getInvoiceVersions: collection("invoice_versions", true),
    getInvoiceEvents: collection("invoice_events", true),
    getInvoiceCounters: collection("invoice_counters"),
    getPaymentIntents: collection("payment_intents", true),
    getQuoteContexts: collection("quote_contexts", true),
    getSettlements: collection("settlements", true),
    getSettlementAllocations: collection("settlement_allocations", true),
    getSettlementAdjustments: collection("settlement_adjustments", true),
    getBusinessKeys: collection("business_keys"),
    getBusinessProfiles: collection("business_profiles"),
    getBusinessMemberships: collection("business_memberships"),
    getUsers: collection("users"),
    getVerificationAudit: collection("verification_audit"),
  };
});
vi.mock("../src/lib/stellar", () => ({
  poolId: "CPOOL",
  usdcSacId: "CUSDC",
  stellarNetwork: "testnet",
  resolveUsernameOnChain: mocks.resolve,
  simulateRead: vi.fn(),
  server: {
    getLatestLedger: async () => ({ sequence: 900 }),
    getTransaction: vi.fn(),
  },
}));
vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireSubmission: async () => ({ contractId: "CACME" }),
}));
vi.mock("../src/server/modules/notifications/notifications.service", () => ({
  notifyBusiness: mocks.notify,
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async () => ({ contractId: "CACME" }),
}));
vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  usernameByOwner: async () => "acme",
}));

import { bytesToHex, commitment, ownerPk, toBE32 } from "../src/lib/crypto";
import type { SignedFeeQuote } from "../src/lib/fee-quote";
import type {
  InvoiceDoc,
  PaymentIntentDoc,
  SettlementAllocationDoc,
  SettlementDoc,
} from "../src/server/db/mongo";
import {
  bindInvoiceIntent,
  recordQuoteAttribution,
} from "../src/server/modules/feeQuotes/feeQuotes.attribution";
import * as invoicesService from "../src/server/modules/invoices/invoices.service";
import {
  createInvoice,
  recomputeInvoice,
  reviseInvoice,
} from "../src/server/modules/invoices/invoices.service";
import { recordPayerSent } from "../src/server/modules/settlements/settlements.intents";
import {
  allocateToInvoice,
  claimHistorical,
  reconcileSettlements,
  recordRefund,
} from "../src/server/modules/settlements/settlements.service";

type MigrationModule = {
  up: (db: Db) => Promise<void>;
  copyAsyncQuoteContexts: (
    db: Db,
    options?: { dryRun?: boolean },
  ) => Promise<{ scanned: number; copied: number; skipped: number }>;
};

const migrationUrl = new URL(
  "../migrations/20261007090000-invoices-settlements.js",
  import.meta.url,
).href;

async function loadMigration(): Promise<MigrationModule> {
  return (await import(migrationUrl)) as MigrationModule;
}

const uri = process.env.OLIO_TEST_MONGODB_URI;
const suite = describe.skipIf(!uri);
let client: MongoClient;

const OWNER = "privy:owner";
const BUSINESS = "biz_acme0001";
const OWNER_SECRET = 123_456_789n;
const VIEW_PUBKEY = new Uint8Array(32).fill(5);
let notePubkey: bigint;
let nextLeaf = 0;

const col = <T extends object>(name: string) =>
  mocks.database().collection<T>(name, { useBigInt64: true });

function sealedVersion(amountDue: bigint) {
  return {
    amountDue: amountDue.toString(),
    dueAt: null,
    encryptedContent: "aa".repeat(64),
    wrappedKey: "bb".repeat(104),
    contentCommitment: "cc".repeat(32),
  };
}

async function issueInvoice(amountDue: bigint) {
  return createInvoice(OWNER, {
    businessId: BUSINESS,
    ...sealedVersion(amountDue),
    issue: true,
  });
}

async function attribute(
  invoice: { invoiceId: string; version: number } | null,
  amount: bigint,
  salt: bigint,
  channel: "direct" | "cctp" = "direct",
) {
  const note = toBE32(await commitment(amount, notePubkey, salt));
  const binding = invoice ? await bindInvoiceIntent(invoice, "CACME") : null;
  const quote = {
    quoteId: binding?.quoteId ?? new Uint8Array(32).fill(Number(salt % 250n)),
    commitment: note,
    paymentAmount: amount,
    channel,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 900),
  } as SignedFeeQuote;
  await recordQuoteAttribution({
    quote,
    recipient: {
      owner: "CACME",
      notePubkey: toBE32(notePubkey),
      viewPubkey: VIEW_PUBKEY,
    },
    binding,
    sourceDomain: channel === "cctp" ? 6 : 0,
  });
  return { quoteId: bytesToHex(quote.quoteId), note };
}

async function indexDeposit(input: {
  note: Uint8Array;
  quoteId: string | null;
  amount: bigint;
  payer?: string;
}) {
  const leaf = nextLeaf++;
  const txHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
  const ledger = 1000 + leaf;
  const ts = new Date();
  await mocks
    .database()
    .collection("deposits")
    .insertOne({
      _id: leaf as never,
      commitment: new Binary(Buffer.from(input.note)),
      ephemeralPk: new Binary(Buffer.alloc(32)),
      ciphertext: new Binary(Buffer.alloc(72)),
      ledger,
      txHash,
      eventId: `${ledger}-1`,
      ts,
    });
  if (input.quoteId) {
    await mocks
      .database()
      .collection("pool_fees")
      .insertOne({
        _id: `${ledger}-2` as never,
        txHash,
        ledger,
        payer: input.payer ?? "GPAYER",
        feeRecipient: "GTREASURY",
        paymentAmount: input.amount.toString(),
        feeAmount: "0",
        totalAmount: input.amount.toString(),
        policyVersion: 2,
        feeBps: 200,
        quoteId: input.quoteId,
        ts,
      });
  }
  await mocks
    .database()
    .collection("indexer_state")
    .updateOne(
      { _id: "pool" as never },
      {
        $set: {
          poolId: "CPOOL",
          publishedLeafIndex: leaf,
          publishedLedger: ledger,
          health: "healthy",
        },
      },
      { upsert: true },
    );
  return { leaf, txHash, settlementId: `testnet:CPOOL:${leaf}` };
}

async function invoice(invoiceId: string) {
  return col<InvoiceDoc>("invoices").findOne({ _id: invoiceId });
}

suite("invoices and settlements against isolated MongoDB", () => {
  beforeAll(async () => {
    process.env.SETTLEMENTS_WORKER_ENABLED = "true";
    client = await new MongoClient(uri as string, {
      serverSelectionTimeoutMS: 3000,
    }).connect();
    mocks.db = client.db(
      `olio_settlements_test_${randomUUID().replaceAll("-", "")}`,
    );
    const migration = await loadMigration();
    await migration.up(mocks.database());
    notePubkey = await ownerPk(OWNER_SECRET);
  }, 30_000);

  afterAll(async () => {
    delete process.env.SETTLEMENTS_WORKER_ENABLED;
    if (mocks.db) await mocks.db.dropDatabase();
    await client?.close();
  });

  beforeEach(async () => {
    const db = mocks.database();
    for (const name of [
      "deposits",
      "pool_fees",
      "indexer_state",
      "withdrawals",
      "invoices",
      "invoice_versions",
      "invoice_events",
      "invoice_counters",
      "payment_intents",
      "quote_contexts",
      "settlements",
      "settlement_allocations",
      "settlement_adjustments",
      "business_keys",
      "business_profiles",
      "business_memberships",
      "users",
    ])
      await db.collection(name).deleteMany({});
    nextLeaf = 0;
    const now = new Date();
    await db.collection("business_profiles").insertOne({
      _id: BUSINESS as never,
      publicId: "pub_acme0001",
      type: "company",
      lifecycle: "active",
      displayName: "Acme",
      username: "acme",
      boundAccount: "CACME",
      boundAt: now,
      createdBy: OWNER,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("business_memberships").insertOne({
      _id: `${BUSINESS}:${OWNER}` as never,
      businessId: BUSINESS,
      privyUserId: OWNER,
      role: "owner",
      createdAt: now,
    });
    await db.collection("users").insertOne({
      _id: "CACME" as never,
      privyUserId: OWNER,
      privyWalletId: "wallet-1",
      privyWalletAddress: "GOWNERWALLET",
      createdAt: now,
      updatedAt: now,
    });
    mocks.resolve.mockResolvedValue({
      owner: "CACME",
      note_pubkey: toBE32(notePubkey),
      view_pubkey: VIEW_PUBKEY,
      created: 0n,
    });
    mocks.notify.mockResolvedValue(undefined);
  });

  it("has no update path for invoices and keeps prior versions on revision", async () => {
    expect(Object.keys(invoicesService)).not.toContain("updateInvoice");
    const created = await issueInvoice(1_000n);
    const revised = await reviseInvoice(OWNER, {
      invoiceId: created.invoiceId,
      expectedVersion: 1,
      ...sealedVersion(1_200n),
    });
    expect(revised.currentVersion).toBe(2);
    expect(revised.amountDue).toBe("1200");
    const versions = await col("invoice_versions")
      .find({ invoiceId: created.invoiceId })
      .sort({ version: 1 })
      .toArray();
    expect(versions.map((v) => v.amountDue)).toEqual([1_000n, 1_200n]);
    expect(versions[0].invoiceCommitment).not.toBe(
      versions[1].invoiceCommitment,
    );
    await expect(
      reviseInvoice(OWNER, {
        invoiceId: created.invoiceId,
        expectedVersion: 1,
        ...sealedVersion(1_300n),
      }),
    ).rejects.toThrow("changed");
  });

  it("blocks revision while a payment is in flight and after allocation", async () => {
    const created = await issueInvoice(1_000n);
    const { quoteId, note } = await attribute(
      { invoiceId: created.invoiceId, version: 1 },
      400n,
      11n,
    );
    await expect(
      reviseInvoice(OWNER, {
        invoiceId: created.invoiceId,
        expectedVersion: 1,
        ...sealedVersion(900n),
      }),
    ).rejects.toThrow("in progress");
    await indexDeposit({ note, quoteId, amount: 400n });
    await reconcileSettlements();
    expect((await invoice(created.invoiceId))?.state).toBe("partially_paid");
    await expect(
      reviseInvoice(OWNER, {
        invoiceId: created.invoiceId,
        expectedVersion: 1,
        ...sealedVersion(900n),
      }),
    ).rejects.toThrow();
  });

  it("settles an intent-bound payment once even when the reconcile replays", async () => {
    const created = await issueInvoice(1_000n);
    const { quoteId, note } = await attribute(
      { invoiceId: created.invoiceId, version: 1 },
      1_000n,
      21n,
    );
    const deposit = await indexDeposit({ note, quoteId, amount: 1_000n });

    const first = await reconcileSettlements();
    expect(first).toMatchObject({ status: "reconciled", inserted: 1 });
    const settlement = await col<SettlementDoc>("settlements").findOne({
      _id: deposit.settlementId,
    });
    expect(settlement).toMatchObject({
      evidenceLevel: "intent_bound",
      businessId: BUSINESS,
      amount: 1_000n,
      allocatedAmount: 1_000n,
      qualification: { counted: true, selfFunded: false },
    });
    expect(settlement?.invoiceCommitment).toBe(
      created.current.invoiceCommitment,
    );
    expect(await invoice(created.invoiceId)).toMatchObject({
      state: "paid",
      allocatedAmount: 1_000n,
    });
    const intent = await col<PaymentIntentDoc>("payment_intents").findOne({
      quoteId,
    });
    expect(intent?.state).toBe("settled");
    const context = await col("quote_contexts").findOne({
      _id: quoteId as never,
    });
    expect(context).not.toHaveProperty("viewPubkey");

    await mocks
      .database()
      .collection("indexer_state")
      .updateOne(
        { _id: "settlements" as never },
        { $set: { lastLeafIndex: -1 } },
      );
    const replay = await reconcileSettlements();
    expect(replay).toMatchObject({ status: "reconciled", inserted: 0 });
    expect(await col("settlements").countDocuments()).toBe(1);
    expect(await col("settlement_allocations").countDocuments()).toBe(1);
    expect((await invoice(created.invoiceId))?.allocatedAmount).toBe(1_000n);
  });

  it("applies partial payments and leaves overpayment unallocated", async () => {
    const created = await issueInvoice(100n);
    const target = { invoiceId: created.invoiceId, version: 1 };
    const partial = await attribute(target, 40n, 31n);
    await indexDeposit({
      note: partial.note,
      quoteId: partial.quoteId,
      amount: 40n,
    });
    await reconcileSettlements();
    expect((await invoice(created.invoiceId))?.state).toBe("partially_paid");

    const over = await attribute(target, 80n, 32n);
    const second = await indexDeposit({
      note: over.note,
      quoteId: over.quoteId,
      amount: 80n,
    });
    await reconcileSettlements();
    expect(await invoice(created.invoiceId)).toMatchObject({
      state: "paid",
      allocatedAmount: 100n,
    });
    const settlement = await col<SettlementDoc>("settlements").findOne({
      _id: second.settlementId,
    });
    expect(settlement?.allocatedAmount).toBe(60n);
    expect(settlement?.amount).toBe(80n);
  });

  it("never over-allocates an invoice under concurrent allocations", async () => {
    const created = await issueInvoice(100n);
    const now = new Date();
    const settlementIds = ["testnet:CPOOL:900", "testnet:CPOOL:901"];
    for (const [index, id] of settlementIds.entries()) {
      await col<SettlementDoc>("settlements").insertOne({
        _id: id,
        network: "testnet",
        poolId: "CPOOL",
        asset: "CUSDC",
        txHash: `${index}`.padStart(64, "0"),
        eventId: null,
        leafIndex: 900 + index,
        noteCommitment: "00".repeat(32),
        quoteId: null,
        intentId: null,
        invoiceCommitment: null,
        businessId: BUSINESS,
        payer: "GPAYER",
        amount: 100n,
        ledger: 1,
        ledgerClosedAt: now,
        rail: "direct",
        railRefs: {
          sourceDomain: null,
          sourceTxHash: null,
          payerSentAt: null,
          mintTxHash: null,
        },
        evidenceLevel: "attributed",
        qualification: { counted: true, selfFunded: false, policyVersion: 1 },
        allocatedAmount: 0n,
        refundedAmount: 0n,
        appliedAllocationIds: [],
        appliedAdjustmentIds: [],
        evidenceVersion: 1,
        issuer: "olio",
        createdAt: now,
        updatedAt: now,
      });
    }
    await Promise.all(
      settlementIds.map((id) => allocateToInvoice(id, created.invoiceId, 1)),
    );
    const head = await invoice(created.invoiceId);
    expect(head?.allocatedAmount).toBe(100n);
    expect(head?.state).toBe("paid");
    const allocations = await col<SettlementAllocationDoc>(
      "settlement_allocations",
    )
      .find({ invoiceId: created.invoiceId })
      .toArray();
    const applied = allocations.filter((a) => a.reversedAt === null);
    expect(applied.reduce((sum, a) => sum + a.amount, 0n)).toBe(100n);
    const settlements = await col<SettlementDoc>("settlements")
      .find({ _id: { $in: settlementIds } })
      .toArray();
    expect(settlements.reduce((sum, s) => sum + s.allocatedAmount, 0n)).toBe(
      100n,
    );
  });

  it("repairs a drifted invoice projection from its allocations", async () => {
    const created = await issueInvoice(500n);
    const { quoteId, note } = await attribute(
      { invoiceId: created.invoiceId, version: 1 },
      200n,
      41n,
    );
    await indexDeposit({ note, quoteId, amount: 200n });
    await reconcileSettlements();
    await col("invoices").updateOne(
      { _id: created.invoiceId as never },
      { $set: { allocatedAmount: 999n, state: "paid" } },
    );
    const repaired = await recomputeInvoice(created.invoiceId);
    expect(repaired).toMatchObject({
      allocatedAmount: 200n,
      state: "partially_paid",
    });
  });

  it("records refunds against indexed withdrawals and rejects excess or reuse", async () => {
    const created = await issueInvoice(100n);
    const { quoteId, note } = await attribute(
      { invoiceId: created.invoiceId, version: 1 },
      100n,
      51n,
    );
    const deposit = await indexDeposit({ note, quoteId, amount: 100n });
    await reconcileSettlements();
    await col("withdrawals").insertMany([
      {
        _id: "aa".repeat(32) as never,
        dest: "GPAYER",
        amount: 150n,
        txHash: "a1".repeat(32),
        eventId: "1-1",
        ledger: 2,
        ts: new Date(),
      },
      {
        _id: "bb".repeat(32) as never,
        dest: "GPAYER",
        amount: 30n,
        txHash: "b1".repeat(32),
        eventId: "2-1",
        ledger: 3,
        ts: new Date(),
      },
    ]);
    await expect(
      recordRefund(OWNER, {
        settlementId: deposit.settlementId,
        withdrawTxHash: "a1".repeat(32),
      }),
    ).rejects.toThrow("larger than the unrefunded");
    const refunded = await recordRefund(OWNER, {
      settlementId: deposit.settlementId,
      withdrawTxHash: "b1".repeat(32),
    });
    expect(refunded.refundedAmount).toBe("30");
    expect(await invoice(created.invoiceId)).toMatchObject({
      state: "partially_paid",
      refundedAmount: 30n,
    });
    const again = await recordRefund(OWNER, {
      settlementId: deposit.settlementId,
      withdrawTxHash: "b1".repeat(32),
    });
    expect(again.refundedAmount).toBe("30");
  });

  it("keeps a CCTP payer-sent marker separate from settlement", async () => {
    const created = await issueInvoice(100n);
    const { quoteId } = await attribute(
      { invoiceId: created.invoiceId, version: 1 },
      100n,
      61n,
      "cctp",
    );
    await recordPayerSent(quoteId);
    const intent = await col<PaymentIntentDoc>("payment_intents").findOne({
      quoteId,
    });
    expect(intent?.state).toBe("open");
    expect(intent?.railRefs.payerSentAt).toBeInstanceOf(Date);
    expect(await col("settlements").countDocuments()).toBe(0);
    expect((await invoice(created.invoiceId))?.state).toBe("issued");
  });

  it("attributes historical notes only with a matching opening", async () => {
    const amount = 75n;
    const salt = 71n;
    const note = toBE32(await commitment(amount, notePubkey, salt));
    const deposit = await indexDeposit({ note, quoteId: null, amount });
    await reconcileSettlements();
    expect(
      (
        await col<SettlementDoc>("settlements").findOne({
          _id: deposit.settlementId,
        })
      )?.evidenceLevel,
    ).toBe("unattributed");

    await expect(
      claimHistorical(OWNER, {
        businessId: BUSINESS,
        leafIndex: deposit.leaf,
        amount: amount.toString(),
        salt: bytesToHex(toBE32(salt + 1n)),
      }),
    ).rejects.toThrow("do not match");
    await expect(
      claimHistorical(OWNER, {
        businessId: BUSINESS,
        leafIndex: deposit.leaf,
        amount: "76",
        salt: bytesToHex(toBE32(salt)),
      }),
    ).rejects.toThrow("do not match");
    const claimed = await claimHistorical(OWNER, {
      businessId: BUSINESS,
      leafIndex: deposit.leaf,
      amount: amount.toString(),
      salt: bytesToHex(toBE32(salt)),
    });
    expect(claimed).toMatchObject({
      evidenceLevel: "historical_claim",
      amount: "75",
    });
  });

  it("upgrades an unattributed deposit once its attribution context exists", async () => {
    const amount = 90n;
    const salt = 81n;
    const note = toBE32(await commitment(amount, notePubkey, salt));
    const quoteId = "ef".repeat(32);
    const deposit = await indexDeposit({ note, quoteId, amount });
    await reconcileSettlements();
    await col("quote_contexts").insertOne({
      _id: quoteId as never,
      channel: "cctp",
      network: "testnet",
      poolId: "CPOOL",
      recipientOwner: "CACME",
      businessId: BUSINESS,
      notePubkey: bytesToHex(toBE32(notePubkey)),
      commitment: bytesToHex(note),
      paymentAmount: null,
      intentId: null,
      settlementId: null,
      source: "async_copy",
      createdAt: new Date(),
    });
    await mocks
      .database()
      .collection("indexer_state")
      .updateOne(
        { _id: "settlements" as never },
        { $set: { lastLeafIndex: -1 } },
      );
    const result = await reconcileSettlements();
    expect(result.upgraded).toBe(1);
    expect(
      await col<SettlementDoc>("settlements").findOne({
        _id: deposit.settlementId,
      }),
    ).toMatchObject({ evidenceLevel: "attributed", businessId: BUSINESS });
  });

  it("marks self-funded payments as not counted", async () => {
    const created = await issueInvoice(100n);
    const { quoteId, note } = await attribute(
      { invoiceId: created.invoiceId, version: 1 },
      100n,
      91n,
    );
    const deposit = await indexDeposit({
      note,
      quoteId,
      amount: 100n,
      payer: "GOWNERWALLET",
    });
    await reconcileSettlements();
    expect(
      (
        await col<SettlementDoc>("settlements").findOne({
          _id: deposit.settlementId,
        })
      )?.qualification,
    ).toMatchObject({ counted: false, selfFunded: true });
  });

  it("creates attribution storage without TTL and only expires open intents", async () => {
    const contextIndexes = await mocks
      .database()
      .collection("quote_contexts")
      .indexes();
    expect(
      contextIndexes.some((index) => index.expireAfterSeconds !== undefined),
    ).toBe(false);
    const intentIndexes = await mocks
      .database()
      .collection("payment_intents")
      .indexes();
    expect(
      intentIndexes.find((index) => index.name === "intent_open_expiry"),
    ).toMatchObject({
      expireAfterSeconds: 7 * 86_400,
      partialFilterExpression: { state: "open" },
    });
  });

  it("copies async CCTP contexts into durable attribution storage", async () => {
    const { copyAsyncQuoteContexts } = await loadMigration();
    await mocks
      .database()
      .collection("async_fee_quote_contexts__CPOOL")
      .insertOne({
        _id: "12".repeat(32) as never,
        channel: "cctp",
        owner: "CACME",
        commitment: "34".repeat(32),
        notePubkey: "56".repeat(32),
        viewPubkey: "78".repeat(32),
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      });
    const dry = await copyAsyncQuoteContexts(mocks.database(), {
      dryRun: true,
    });
    expect(dry.copied).toBe(1);
    expect(await col("quote_contexts").countDocuments()).toBe(0);
    const executed = await copyAsyncQuoteContexts(mocks.database());
    expect(executed.copied).toBe(1);
    expect(
      await col("quote_contexts").findOne({ _id: "12".repeat(32) as never }),
    ).toMatchObject({
      poolId: "CPOOL",
      businessId: BUSINESS,
      source: "async_copy",
    });
    expect((await copyAsyncQuoteContexts(mocks.database())).copied).toBe(0);
  });
});
