import "server-only";
import { randomUUID } from "node:crypto";
import { getServerEnv } from "../../../env.server";
import { bytesToHex, commitment, fromBE, R } from "../../../lib/crypto";
import { poolId, stellarNetwork, usdcSacId } from "../../../lib/stellar";
import {
  type BusinessProfileDoc,
  type DepositDoc,
  type FeeDoc,
  getBusinessMemberships,
  getBusinessProfiles,
  getCctpRelays,
  getCctpSessions,
  getDeposits,
  getFees,
  getIndexerState,
  getInvoices,
  getPaymentIntents,
  getQuoteContexts,
  getSettlementAdjustments,
  getSettlementAllocations,
  getSettlements,
  getUsers,
  getWithdrawals,
  type PaymentIntentDoc,
  type QuoteContextDoc,
  type SettlementAllocationDoc,
  type SettlementDoc,
} from "../../db/mongo";
import { acquireStateLease, releaseStateLease } from "../../lib/stateLease";
import {
  businessKeyHistory,
  ensureBusinessKeys,
  syncBusinessKeys,
} from "../businesses/businesses.keys";
import {
  assertManager,
  assertMember,
  recordAudit,
} from "../businesses/businesses.service";
import {
  appendInvoiceEvent,
  recomputeInvoice,
} from "../invoices/invoices.service";
import { remainingDue } from "../invoices/invoices.state";
import { notifyBusiness } from "../notifications/notifications.service";
import {
  SettlementNotFoundError,
  SettlementStateError,
} from "./settlements.errors";
import {
  allocatableAmount,
  allocationIdFor,
  EVIDENCE_VERSION,
  qualify,
  settlementIdFor,
} from "./settlements.policy";
import type {
  ClaimHistoricalInput,
  ListSettlementsInput,
  RecordRefundInput,
  SettlementListOutput,
  SettlementOutput,
  SettlementsByLeavesInput,
} from "./settlements.schema";

const LEASE_MS = 50_000;
const BATCH_SIZE = 200;
const MAX_BATCHES = 10;
const ALLOCATION_REPAIR_AFTER_MS = 2 * 60_000;
const NOTIFY_WINDOW_MS = 24 * 60 * 60_000;
const WORKER_ACTOR = "worker:settlements";

export type ReconcileResult = {
  status: "reconciled" | "skipped" | "disabled" | "degraded";
  fromLeafIndex: number;
  toLeafIndex: number;
  inserted: number;
  upgraded: number;
  allocated: number;
  repaired: number;
  durationMs: number;
  error?: string;
};

type ReconcileOutcome = {
  inserted: boolean;
  upgraded: boolean;
  allocated: boolean;
};

const iso = (date: Date | null | undefined) =>
  date ? date.toISOString() : null;

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

export function settlementsEnabled(): boolean {
  return getServerEnv().SETTLEMENTS_WORKER_ENABLED === "true";
}

export async function ownAccountsFor(
  business: BusinessProfileDoc,
): Promise<Set<string>> {
  const accounts = new Set<string>();
  if (business.boundAccount) accounts.add(business.boundAccount);
  const memberships = await (await getBusinessMemberships())
    .find({ businessId: business._id })
    .toArray();
  if (memberships.length === 0) return accounts;
  const users = await (await getUsers())
    .find({ privyUserId: { $in: memberships.map((m) => m.privyUserId) } })
    .toArray();
  for (const user of users) {
    accounts.add(user._id);
    accounts.add(user.privyWalletAddress);
  }
  return accounts;
}

function contextMatches(
  context: QuoteContextDoc,
  deposit: DepositDoc,
  fee: FeeDoc,
): boolean {
  return (
    context.network === stellarNetwork &&
    context.poolId === poolId &&
    context.commitment === bytesToHex(deposit.commitment.buffer) &&
    (context.paymentAmount === null ||
      context.paymentAmount === BigInt(fee.paymentAmount))
  );
}

function intentMatches(
  intent: PaymentIntentDoc | null,
  context: QuoteContextDoc,
  fee: FeeDoc,
): intent is PaymentIntentDoc {
  return (
    intent !== null &&
    intent.quoteId === fee.quoteId &&
    intent.noteCommitment === context.commitment &&
    intent.amount === BigInt(fee.paymentAmount) &&
    intent.businessId === context.businessId
  );
}

async function railRefsFor(
  quoteId: string | null,
  intent: PaymentIntentDoc | null,
  channel: QuoteContextDoc["channel"] | null,
): Promise<SettlementDoc["railRefs"]> {
  const refs: SettlementDoc["railRefs"] = {
    sourceDomain: intent?.railRefs.sourceDomain ?? null,
    sourceTxHash: null,
    payerSentAt: intent?.railRefs.payerSentAt ?? null,
    mintTxHash: null,
  };
  if (!quoteId || channel !== "cctp") return refs;
  const [session, relay] = await Promise.all([
    (await getCctpSessions()).findOne({ quoteId }),
    (await getCctpRelays()).findOne({ quoteId }),
  ]);
  return {
    ...refs,
    sourceDomain: refs.sourceDomain ?? session?.sourceDomain ?? null,
    sourceTxHash: session?.sourceTxHash ?? null,
    mintTxHash: relay?.mintTxHash ?? null,
  };
}

async function buildSettlement(
  deposit: DepositDoc,
  now: Date,
): Promise<SettlementDoc> {
  const fee = await (await getFees()).findOne({ txHash: deposit.txHash });
  const rawContext = fee
    ? await (await getQuoteContexts()).findOne({ _id: fee.quoteId })
    : null;
  const context =
    fee && rawContext && contextMatches(rawContext, deposit, fee)
      ? rawContext
      : null;
  if (fee && rawContext && !context) {
    console.warn(
      "[settlements] quote context does not match the indexed deposit",
      JSON.stringify({ leafIndex: deposit._id }),
    );
  }
  const rawIntent = context?.intentId
    ? await (await getPaymentIntents()).findOne({ _id: context.intentId })
    : null;
  const intent =
    context && fee && intentMatches(rawIntent, context, fee) ? rawIntent : null;
  const businessId = context?.businessId ?? null;
  const business = businessId
    ? await (await getBusinessProfiles()).findOne({ _id: businessId })
    : null;
  const amount = fee ? BigInt(fee.paymentAmount) : null;
  const payer = fee?.payer ?? null;
  return {
    _id: settlementIdFor(stellarNetwork, poolId, deposit._id),
    network: stellarNetwork,
    poolId,
    asset: usdcSacId,
    txHash: deposit.txHash,
    eventId: deposit.eventId ?? null,
    leafIndex: deposit._id,
    noteCommitment: bytesToHex(deposit.commitment.buffer),
    quoteId: fee?.quoteId ?? null,
    intentId: intent?._id ?? null,
    invoiceCommitment: intent?.invoiceCommitment ?? null,
    businessId: business ? business._id : null,
    payer,
    amount,
    ledger: deposit.ledger,
    ledgerClosedAt: deposit.ts,
    rail: context?.channel === "cctp" ? "cctp" : "direct",
    railRefs: await railRefsFor(
      fee?.quoteId ?? null,
      intent,
      context?.channel ?? null,
    ),
    evidenceLevel: !business
      ? "unattributed"
      : intent
        ? "intent_bound"
        : "attributed",
    qualification: qualify({
      payer,
      ownAccounts: business ? await ownAccountsFor(business) : new Set(),
      amount,
      refundedAmount: 0n,
    }),
    allocatedAmount: 0n,
    refundedAmount: 0n,
    appliedAllocationIds: [],
    appliedAdjustmentIds: [],
    evidenceVersion: EVIDENCE_VERSION,
    issuer: "olio",
    createdAt: now,
    updatedAt: now,
  };
}

const ATTRIBUTION_FIELDS = [
  "quoteId",
  "intentId",
  "invoiceCommitment",
  "businessId",
  "payer",
  "amount",
  "rail",
  "railRefs",
  "evidenceLevel",
  "qualification",
] as const;

export async function reconcileDeposit(
  deposit: DepositDoc,
): Promise<ReconcileOutcome> {
  const settlements = await getSettlements();
  const now = new Date();
  const id = settlementIdFor(stellarNetwork, poolId, deposit._id);
  let settlement = await settlements.findOne({ _id: id });
  const outcome: ReconcileOutcome = {
    inserted: false,
    upgraded: false,
    allocated: false,
  };
  if (!settlement || settlement.evidenceLevel === "unattributed") {
    const built = await buildSettlement(deposit, now);
    if (!settlement) {
      try {
        await settlements.insertOne(built);
        settlement = built;
        outcome.inserted = true;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        settlement = await settlements.findOne({ _id: id });
      }
    } else if (built.evidenceLevel !== "unattributed") {
      const upgrade = Object.fromEntries(
        ATTRIBUTION_FIELDS.map((field) => [field, built[field]]),
      );
      const updated = await settlements.findOneAndUpdate(
        { _id: id, evidenceLevel: "unattributed" },
        { $set: { ...upgrade, updatedAt: now } },
        { returnDocument: "after" },
      );
      if (updated) {
        settlement = updated;
        outcome.upgraded = true;
      } else {
        settlement = await settlements.findOne({ _id: id });
      }
    }
  }
  if (!settlement) return outcome;
  outcome.allocated = await finishSettlement(settlement);
  return outcome;
}

async function finishSettlement(settlement: SettlementDoc): Promise<boolean> {
  if (!settlement.businessId) return false;
  const now = new Date();
  if (settlement.quoteId) {
    await (await getQuoteContexts()).updateOne(
      { _id: settlement.quoteId },
      { $unset: { viewPubkey: "" }, $set: { settlementId: settlement._id } },
    );
  }
  try {
    await ensureBusinessKeys(settlement.businessId);
  } catch (error) {
    console.warn(
      "[settlements] business key history unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (now.getTime() - settlement.ledgerClosedAt.getTime() < NOTIFY_WINDOW_MS) {
    await notifyBusiness({
      id: `${settlement._id}:payment_received`,
      businessId: settlement.businessId,
      kind: "payment_received",
      at: settlement.ledgerClosedAt,
    });
  }
  if (!settlement.intentId) return false;
  const intents = await getPaymentIntents();
  await intents.updateOne(
    { _id: settlement.intentId, state: { $ne: "settled" } },
    {
      $set: { state: "settled", settlementId: settlement._id, settledAt: now },
    },
  );
  const intent = await intents.findOne({ _id: settlement.intentId });
  if (!intent) return false;
  const allocation = await allocateToInvoice(
    settlement._id,
    intent.invoiceId,
    intent.invoiceVersion,
  );
  return Boolean(allocation?.appliedAt);
}

async function reverseAllocation(
  allocationId: string,
  reason: string,
): Promise<void> {
  await (await getSettlementAllocations()).updateOne(
    { _id: allocationId, reversedAt: null },
    { $set: { reversedAt: new Date(), reversalReason: reason } },
  );
}

async function applyAllocation(
  allocation: SettlementAllocationDoc,
): Promise<SettlementAllocationDoc | null> {
  const settlements = await getSettlements();
  const invoices = await getInvoices();
  const allocations = await getSettlementAllocations();
  const now = new Date();
  const settlementApplied = await settlements.updateOne(
    {
      _id: allocation.settlementId,
      amount: { $ne: null },
      appliedAllocationIds: { $ne: allocation._id },
      $expr: {
        $lte: [{ $add: ["$allocatedAmount", allocation.amount] }, "$amount"],
      },
    },
    {
      $inc: { allocatedAmount: allocation.amount },
      $addToSet: { appliedAllocationIds: allocation._id },
      $set: { updatedAt: now },
    },
  );
  if (settlementApplied.matchedCount === 0) {
    const current = await settlements.findOne({ _id: allocation.settlementId });
    if (!current?.appliedAllocationIds.includes(allocation._id)) {
      await reverseAllocation(allocation._id, "settlement_cap");
      return allocations.findOne({ _id: allocation._id });
    }
  }
  const invoiceApplied = await invoices.updateOne(
    {
      _id: allocation.invoiceId,
      appliedAllocationIds: { $ne: allocation._id },
      $expr: {
        $lte: [
          {
            $add: [
              { $subtract: ["$allocatedAmount", "$refundedAmount"] },
              allocation.amount,
            ],
          },
          "$amountDue",
        ],
      },
    },
    {
      $inc: { allocatedAmount: allocation.amount, projectionRevision: 1 },
      $addToSet: { appliedAllocationIds: allocation._id },
      $set: { updatedAt: now },
    },
  );
  if (invoiceApplied.matchedCount === 0) {
    const current = await invoices.findOne({ _id: allocation.invoiceId });
    if (!current?.appliedAllocationIds.includes(allocation._id)) {
      await settlements.updateOne(
        { _id: allocation.settlementId, appliedAllocationIds: allocation._id },
        {
          $inc: { allocatedAmount: -allocation.amount },
          $pull: { appliedAllocationIds: allocation._id },
          $set: { updatedAt: now },
        },
      );
      await reverseAllocation(allocation._id, "invoice_cap");
      return allocations.findOne({ _id: allocation._id });
    }
  }
  await allocations.updateOne(
    { _id: allocation._id, appliedAt: null },
    { $set: { appliedAt: now } },
  );
  const invoice = await recomputeInvoice(allocation.invoiceId);
  if (invoice) {
    await appendInvoiceEvent({
      invoice,
      kind: "allocation",
      version: allocation.invoiceVersion,
      amount: allocation.amount,
      settlementId: allocation.settlementId,
      actor: WORKER_ACTOR,
      eventId: `allocation:${allocation._id}`,
    });
    await recordAudit({
      actor: WORKER_ACTOR,
      action: "settlement.allocated",
      businessId: invoice.businessId,
      reasonCode: `invoice:${invoice._id}`,
    });
    if (invoice.state === "paid" || invoice.state === "partially_paid") {
      await notifyBusiness({
        id: `${allocation._id}:${invoice.state}`,
        businessId: invoice.businessId,
        kind:
          invoice.state === "paid" ? "invoice_paid" : "invoice_partially_paid",
      });
    }
  }
  return allocations.findOne({ _id: allocation._id });
}

export async function allocateToInvoice(
  settlementId: string,
  invoiceId: string,
  invoiceVersion: number,
): Promise<SettlementAllocationDoc | null> {
  const allocations = await getSettlementAllocations();
  const id = allocationIdFor(settlementId, invoiceId, invoiceVersion);
  let allocation = await allocations.findOne({ _id: id });
  if (allocation?.reversedAt) return allocation;
  if (allocation?.appliedAt) {
    await recomputeInvoice(invoiceId);
    return allocation;
  }
  if (!allocation) {
    const [settlement, invoice] = await Promise.all([
      (await getSettlements()).findOne({ _id: settlementId }),
      recomputeInvoice(invoiceId),
    ]);
    if (!settlement || !invoice) return null;
    const amount = allocatableAmount({
      settlementAmount: settlement.amount,
      settlementAllocated: settlement.allocatedAmount,
      invoiceRemaining: remainingDue(invoice),
    });
    if (amount <= 0n) return null;
    const doc: SettlementAllocationDoc = {
      _id: id,
      settlementId,
      invoiceId,
      invoiceVersion,
      amount,
      createdAt: new Date(),
      appliedAt: null,
      reversedAt: null,
      reversalReason: null,
    };
    try {
      await allocations.insertOne(doc);
      allocation = doc;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      allocation = await allocations.findOne({ _id: id });
    }
    if (!allocation || allocation.reversedAt || allocation.appliedAt)
      return allocation;
  }
  return applyAllocation(allocation);
}

export async function repairPendingAllocations(
  now = new Date(),
): Promise<number> {
  const pending = await (await getSettlementAllocations())
    .find({
      appliedAt: null,
      reversedAt: null,
      createdAt: { $lt: new Date(now.getTime() - ALLOCATION_REPAIR_AFTER_MS) },
    })
    .limit(100)
    .toArray();
  for (const allocation of pending) await applyAllocation(allocation);
  return pending.length;
}

export async function reconcileSettlements(): Promise<ReconcileResult> {
  const startedAt = Date.now();
  const empty = {
    fromLeafIndex: -1,
    toLeafIndex: -1,
    inserted: 0,
    upgraded: 0,
    allocated: 0,
    repaired: 0,
  };
  if (!settlementsEnabled()) {
    return { status: "disabled", ...empty, durationMs: 0 };
  }
  const owner = randomUUID();
  if (!(await acquireStateLease("settlements", owner, LEASE_MS))) {
    return { status: "skipped", ...empty, durationMs: Date.now() - startedAt };
  }
  const states = await getIndexerState();
  const totals = { ...empty };
  try {
    const [pool, state] = await Promise.all([
      states.findOne({ _id: "pool" }),
      states.findOne({ _id: "settlements" }),
    ]);
    if (
      !pool ||
      pool.poolId !== poolId ||
      pool.publishedLeafIndex === undefined
    )
      throw new Error("The pool index has not been published for this pool.");
    if (state?.poolId && state.poolId !== poolId)
      throw new Error("Settlement state belongs to a different pool.");
    const published = pool.publishedLeafIndex;
    let watermark = state?.lastLeafIndex ?? -1;
    totals.fromLeafIndex = watermark;
    const deposits = await getDeposits();
    for (
      let batch = 0;
      batch < MAX_BATCHES && watermark < published;
      batch += 1
    ) {
      const rows = await deposits
        .find({ _id: { $gt: watermark, $lte: published } })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .toArray();
      if (rows.length === 0) break;
      for (const deposit of rows) {
        if (deposit._id !== watermark + 1)
          throw new Error(`Deposit mirror gap before leaf ${deposit._id}.`);
        const outcome = await reconcileDeposit(deposit);
        if (outcome.inserted) totals.inserted += 1;
        if (outcome.upgraded) totals.upgraded += 1;
        if (outcome.allocated) totals.allocated += 1;
        watermark = deposit._id;
      }
      await states.updateOne(
        { _id: "settlements", leaseOwner: owner },
        { $set: { poolId, lastLeafIndex: watermark, updatedAt: new Date() } },
      );
    }
    totals.repaired = await repairPendingAllocations();
    totals.toLeafIndex = watermark;
    const now = new Date();
    await states.updateOne(
      { _id: "settlements", leaseOwner: owner },
      {
        $set: {
          poolId,
          lastLeafIndex: watermark,
          publishedLeafIndex: published,
          lastRunAt: now,
          updatedAt: now,
          health: "healthy",
          degradedReasons: [],
        },
        $unset: { lastError: "" },
      },
    );
    return {
      status: "reconciled",
      ...totals,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Settlement reconcile failed";
    await states.updateOne(
      { _id: "settlements", leaseOwner: owner },
      {
        $set: {
          health: "degraded",
          lastError: message,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    return {
      status: "degraded",
      ...totals,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  } finally {
    await releaseStateLease("settlements", owner);
  }
}

export async function reconcileLeaf(
  leafIndex: number,
): Promise<ReconcileOutcome> {
  const [pool, deposit] = await Promise.all([
    (await getIndexerState()).findOne({ _id: "pool" }),
    (await getDeposits()).findOne({ _id: leafIndex }),
  ]);
  if (
    !pool ||
    pool.poolId !== poolId ||
    (pool.publishedLeafIndex ?? -1) < leafIndex
  )
    throw new SettlementStateError("not_indexed");
  if (!deposit) throw new SettlementStateError("index_gap");
  return reconcileDeposit(deposit);
}

async function invoiceRefsFor(
  settlementIds: string[],
): Promise<Map<string, { invoiceId: string; number: number }[]>> {
  const refs = new Map<string, { invoiceId: string; number: number }[]>();
  if (settlementIds.length === 0) return refs;
  const allocations = await (await getSettlementAllocations())
    .find({ settlementId: { $in: settlementIds }, reversedAt: null })
    .toArray();
  const invoices = await (await getInvoices())
    .find({ _id: { $in: [...new Set(allocations.map((a) => a.invoiceId))] } })
    .project<{ _id: string; number: number }>({ number: 1 })
    .toArray();
  const numbers = new Map(invoices.map((i) => [i._id, i.number]));
  for (const allocation of allocations) {
    const number = numbers.get(allocation.invoiceId);
    if (number === undefined) continue;
    const list = refs.get(allocation.settlementId) ?? [];
    if (!list.some((r) => r.invoiceId === allocation.invoiceId))
      list.push({ invoiceId: allocation.invoiceId, number });
    refs.set(allocation.settlementId, list);
  }
  return refs;
}

export function toSettlementOutput(
  doc: SettlementDoc,
  invoices: { invoiceId: string; number: number }[] = [],
): SettlementOutput {
  return {
    settlementId: doc._id,
    leafIndex: doc.leafIndex,
    txHash: doc.txHash,
    eventId: doc.eventId,
    ledger: doc.ledger,
    ledgerClosedAt: doc.ledgerClosedAt.toISOString(),
    amount: doc.amount === null ? null : doc.amount.toString(),
    allocatedAmount: doc.allocatedAmount.toString(),
    refundedAmount: doc.refundedAmount.toString(),
    payer: doc.payer,
    rail: doc.rail,
    railRefs: {
      sourceDomain: doc.railRefs.sourceDomain,
      sourceTxHash: doc.railRefs.sourceTxHash,
      payerSentAt: iso(doc.railRefs.payerSentAt),
      mintTxHash: doc.railRefs.mintTxHash,
    },
    evidenceLevel: doc.evidenceLevel,
    qualification: doc.qualification,
    invoices,
  };
}

async function withInvoices(
  docs: SettlementDoc[],
): Promise<SettlementOutput[]> {
  const refs = await invoiceRefsFor(docs.map((d) => d._id));
  return docs.map((doc) => toSettlementOutput(doc, refs.get(doc._id) ?? []));
}

export async function listSettlements(
  privyUserId: string,
  input: ListSettlementsInput,
): Promise<SettlementListOutput> {
  await assertMember(privyUserId, input.businessId);
  const rows = await (await getSettlements())
    .find({
      businessId: input.businessId,
      network: stellarNetwork,
      poolId,
      ...(input.beforeLeafIndex !== undefined
        ? { leafIndex: { $lt: input.beforeLeafIndex } }
        : {}),
    })
    .sort({ leafIndex: -1 })
    .limit(input.limit + 1)
    .toArray();
  const page = rows.slice(0, input.limit);
  return {
    items: await withInvoices(page),
    nextBeforeLeafIndex:
      rows.length > input.limit ? (page.at(-1)?.leafIndex ?? null) : null,
  };
}

export async function settlementsByLeaves(
  privyUserId: string,
  input: SettlementsByLeavesInput,
): Promise<SettlementOutput[]> {
  await assertMember(privyUserId, input.businessId);
  if (input.leafIndexes.length === 0) return [];
  const rows = await (await getSettlements())
    .find({
      businessId: input.businessId,
      network: stellarNetwork,
      poolId,
      leafIndex: { $in: input.leafIndexes },
    })
    .toArray();
  return withInvoices(rows);
}

async function managedSettlement(privyUserId: string, settlementId: string) {
  const settlement = await (await getSettlements()).findOne({
    _id: settlementId,
  });
  if (!settlement?.businessId) throw new SettlementNotFoundError();
  await assertManager(privyUserId, settlement.businessId);
  if (settlement.network !== stellarNetwork || settlement.poolId !== poolId)
    throw new SettlementStateError("network_mismatch");
  return settlement as SettlementDoc & { businessId: string };
}

export async function recordRefund(
  privyUserId: string,
  input: RecordRefundInput,
): Promise<SettlementOutput> {
  const settlement = await managedSettlement(privyUserId, input.settlementId);
  if (settlement.amount === null)
    throw new SettlementStateError("amount_unknown");
  const withdrawal = await (await getWithdrawals()).findOne({
    txHash: input.withdrawTxHash,
  });
  if (!withdrawal) throw new SettlementStateError("withdrawal_not_indexed");
  const adjustments = await getSettlementAdjustments();
  const existing = await adjustments.findOne({ _id: withdrawal._id });
  if (existing && existing.settlementId !== settlement._id)
    throw new SettlementStateError("withdrawal_already_claimed");
  if (
    !existing &&
    withdrawal.amount > settlement.amount - settlement.refundedAmount
  )
    throw new SettlementStateError("refund_exceeds");
  if (!existing) {
    try {
      await adjustments.insertOne({
        _id: withdrawal._id,
        settlementId: settlement._id,
        businessId: settlement.businessId,
        kind: "refund",
        amount: withdrawal.amount,
        withdrawTxHash: withdrawal.txHash,
        nullifier: withdrawal._id,
        dest: withdrawal.dest,
        recordedBy: privyUserId,
        verifiedAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await adjustments.findOne({ _id: withdrawal._id });
      if (raced?.settlementId !== settlement._id)
        throw new SettlementStateError("withdrawal_already_claimed");
    }
  }
  const settlements = await getSettlements();
  const applied = await settlements.updateOne(
    {
      _id: settlement._id,
      appliedAdjustmentIds: { $ne: withdrawal._id },
      $expr: {
        $lte: [{ $add: ["$refundedAmount", withdrawal.amount] }, "$amount"],
      },
    },
    {
      $inc: { refundedAmount: withdrawal.amount },
      $addToSet: { appliedAdjustmentIds: withdrawal._id },
      $set: { updatedAt: new Date() },
    },
  );
  if (applied.matchedCount === 0) {
    const current = await settlements.findOne({ _id: settlement._id });
    if (!current?.appliedAdjustmentIds.includes(withdrawal._id)) {
      await adjustments.deleteOne({
        _id: withdrawal._id,
        settlementId: settlement._id,
      });
      throw new SettlementStateError("refund_exceeds");
    }
  }
  const updated = await requalify(settlement._id);
  const allocations = await (await getSettlementAllocations())
    .find({ settlementId: settlement._id, reversedAt: null })
    .toArray();
  for (const invoiceId of new Set(allocations.map((a) => a.invoiceId))) {
    const invoice = await recomputeInvoice(invoiceId);
    if (invoice)
      await appendInvoiceEvent({
        invoice,
        kind: "refund",
        amount: withdrawal.amount,
        settlementId: settlement._id,
        actor: privyUserId,
        eventId: `refund:${withdrawal._id}:${invoiceId}`,
      });
  }
  await recordAudit({
    actor: privyUserId,
    action: "settlement.refund_recorded",
    businessId: settlement.businessId,
    reasonCode: `settlement:${settlement._id}`,
  });
  const [output] = await withInvoices([updated]);
  return output;
}

async function requalify(settlementId: string): Promise<SettlementDoc> {
  const settlements = await getSettlements();
  const settlement = await settlements.findOne({ _id: settlementId });
  if (!settlement) throw new SettlementNotFoundError();
  const business = settlement.businessId
    ? await (await getBusinessProfiles()).findOne({
        _id: settlement.businessId,
      })
    : null;
  const qualification = qualify({
    payer: settlement.payer,
    ownAccounts: business ? await ownAccountsFor(business) : new Set(),
    amount: settlement.amount,
    refundedAmount: settlement.refundedAmount,
  });
  const updated = await settlements.findOneAndUpdate(
    { _id: settlementId },
    { $set: { qualification, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return updated ?? settlement;
}

export async function claimHistorical(
  privyUserId: string,
  input: ClaimHistoricalInput,
): Promise<SettlementOutput> {
  const { business } = await assertManager(privyUserId, input.businessId);
  if (business.lifecycle !== "active")
    throw new SettlementStateError("business_inactive");
  const amount = BigInt(input.amount);
  const salt = BigInt(`0x${input.salt}`);
  if (salt >= R) throw new SettlementStateError("opening_mismatch");
  const pool = await (await getIndexerState()).findOne({ _id: "pool" });
  if (
    !pool ||
    pool.poolId !== poolId ||
    (pool.publishedLeafIndex ?? -1) < input.leafIndex
  )
    throw new SettlementStateError("not_indexed");
  const deposit = await (await getDeposits()).findOne({ _id: input.leafIndex });
  if (!deposit) throw new SettlementStateError("index_gap");
  try {
    await syncBusinessKeys(business._id, "sync");
  } catch (error) {
    console.warn(
      "[settlements] key sync before historical claim failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  const keys = await businessKeyHistory(business._id);
  if (keys.length === 0) throw new SettlementStateError("no_keys");
  const target = fromBE(deposit.commitment.buffer);
  let matched = false;
  for (const key of keys) {
    if (
      (await commitment(amount, BigInt(`0x${key.notePubkey}`), salt)) === target
    ) {
      matched = true;
      break;
    }
  }
  if (!matched) throw new SettlementStateError("opening_mismatch");
  const settlements = await getSettlements();
  const id = settlementIdFor(stellarNetwork, poolId, input.leafIndex);
  const settlement = await settlements.findOne({ _id: id });
  if (!settlement) throw new SettlementStateError("not_reconciled");
  if (settlement.businessId && settlement.businessId !== business._id)
    throw new SettlementStateError("attributed_elsewhere");
  if (settlement.evidenceLevel !== "unattributed") {
    const [output] = await withInvoices([settlement]);
    return output;
  }
  if (settlement.amount !== null && settlement.amount !== amount)
    throw new SettlementStateError("opening_mismatch");
  const qualification = qualify({
    payer: settlement.payer,
    ownAccounts: await ownAccountsFor(business),
    amount,
    refundedAmount: settlement.refundedAmount,
  });
  const updated = await settlements.findOneAndUpdate(
    { _id: id, evidenceLevel: "unattributed" },
    {
      $set: {
        businessId: business._id,
        evidenceLevel: "historical_claim",
        amount,
        qualification,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  const result = updated ?? (await settlements.findOne({ _id: id }));
  if (!result || result.businessId !== business._id)
    throw new SettlementStateError("attributed_elsewhere");
  if (updated) {
    await recordAudit({
      actor: privyUserId,
      action: "settlement.historical_claimed",
      businessId: business._id,
      reasonCode: `settlement:${id}`,
    });
  }
  const [output] = await withInvoices([result]);
  return output;
}
