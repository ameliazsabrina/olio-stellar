import "server-only";
import { invoiceCommitment } from "../../../lib/invoiceCrypto";
import { poolId, stellarNetwork, usdcSacId } from "../../../lib/stellar";
import {
  type BusinessProfileDoc,
  getBusinessProfiles,
  getInvoiceCounters,
  getInvoiceEvents,
  getInvoices,
  getInvoiceVersions,
  getPaymentIntents,
  getSettlementAllocations,
  getSettlements,
  type InvoiceDoc,
  type InvoiceEventKind,
  type InvoiceState,
  type InvoiceVersionDoc,
  type SettlementAllocationDoc,
} from "../../db/mongo";
import {
  assertManager,
  assertMember,
  newOpaqueId,
  recordAudit,
} from "../businesses/businesses.service";
import { requireSubmission } from "../verification/verification.submission";
import {
  InvoiceConfigError,
  InvoiceConflictError,
  InvoiceNotFoundError,
  InvoiceStateError,
} from "./invoices.errors";
import type {
  CreateInvoiceInput,
  InvoiceDetailOutput,
  InvoiceListOutput,
  InvoiceSummaryOutput,
  InvoiceVersionOutput,
  IssueInvoiceInput,
  ListInvoicesInput,
  PublicInvoiceOutput,
  ReviseInvoiceInput,
} from "./invoices.schema";
import {
  deriveInvoiceState,
  PAYABLE_STATES,
  REVISABLE_STATES,
  refundSharesByAllocation,
  remainingDue,
} from "./invoices.state";

const iso = (date: Date | null | undefined) =>
  date ? date.toISOString() : null;

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number }).code === 11000;
}

export function invoiceConfig() {
  if (!poolId || !usdcSacId) throw new InvoiceConfigError();
  return { network: stellarNetwork, poolId, asset: usdcSacId };
}

export const versionId = (invoiceId: string, version: number) =>
  `${invoiceId}:${version}`;

export function toVersionOutput(doc: InvoiceVersionDoc): InvoiceVersionOutput {
  return {
    version: doc.version,
    network: doc.network,
    poolId: doc.poolId,
    asset: doc.asset,
    amountDue: doc.amountDue.toString(),
    issuedAt: doc.issuedAt.toISOString(),
    dueAt: iso(doc.dueAt),
    encryptedContent: doc.encryptedContent,
    wrappedKey: doc.wrappedKey,
    contentCommitment: doc.contentCommitment,
    invoiceCommitment: doc.invoiceCommitment,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toSummaryOutput(
  head: InvoiceDoc,
  current: InvoiceVersionDoc,
): InvoiceSummaryOutput {
  return {
    invoiceId: head._id,
    businessId: head.businessId,
    number: head.number,
    state: head.state,
    currentVersion: head.currentVersion,
    amountDue: head.amountDue.toString(),
    allocatedAmount: head.allocatedAmount.toString(),
    refundedAmount: head.refundedAmount.toString(),
    paidAmount: (head.allocatedAmount - head.refundedAmount).toString(),
    remainingAmount: remainingDue(head).toString(),
    issuedAt: iso(head.issuedAt),
    cancelledAt: iso(head.cancelledAt ?? head.voidedAt),
    erased: head.erasedAt !== null,
    createdAt: head.createdAt.toISOString(),
    updatedAt: head.updatedAt.toISOString(),
    current: toVersionOutput(current),
  };
}

async function nextInvoiceNumber(businessId: string): Promise<number> {
  const counters = await getInvoiceCounters();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const counter = await counters.findOneAndUpdate(
        { _id: businessId },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" },
      );
      if (counter) return counter.seq;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new InvoiceConflictError();
}

async function appendEvent(entry: {
  invoice: Pick<InvoiceDoc, "_id" | "businessId">;
  kind: InvoiceEventKind;
  version?: number | null;
  amount?: bigint | null;
  settlementId?: string | null;
  actor: string;
  eventId?: string;
}): Promise<void> {
  const _id = entry.eventId ?? newOpaqueId(16);
  try {
    await (await getInvoiceEvents()).insertOne({
      _id,
      invoiceId: entry.invoice._id,
      businessId: entry.invoice.businessId,
      kind: entry.kind,
      version: entry.version ?? null,
      amount: entry.amount ?? null,
      settlementId: entry.settlementId ?? null,
      actor: entry.actor,
      at: new Date(),
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

export { appendEvent as appendInvoiceEvent };

function buildVersion(input: {
  invoiceId: string;
  businessId: string;
  version: number;
  amountDue: bigint;
  issuedAt: Date;
  dueAt: Date | null;
  encryptedContent: string | null;
  wrappedKey: string | null;
  contentCommitment: string;
  createdBy: string;
}): InvoiceVersionDoc {
  const config = invoiceConfig();
  return {
    _id: versionId(input.invoiceId, input.version),
    invoiceId: input.invoiceId,
    version: input.version,
    businessId: input.businessId,
    network: config.network,
    poolId: config.poolId,
    asset: config.asset,
    amountDue: input.amountDue,
    issuedAt: input.issuedAt,
    dueAt: input.dueAt,
    encryptedContent: input.encryptedContent,
    wrappedKey: input.wrappedKey,
    contentCommitment: input.contentCommitment,
    invoiceCommitment: invoiceCommitment({
      businessId: input.businessId,
      invoiceId: input.invoiceId,
      version: input.version,
      network: config.network,
      poolId: config.poolId,
      asset: config.asset,
      amountDue: input.amountDue,
      issuedAt: input.issuedAt,
      dueAt: input.dueAt,
      contentCommitment: input.contentCommitment,
    }),
    createdBy: input.createdBy,
    createdAt: new Date(),
  };
}

function assertInvoicingBusiness(business: BusinessProfileDoc): void {
  if (business.lifecycle !== "active")
    throw new InvoiceStateError("business_inactive");
  if (!business.boundAccount) throw new InvoiceStateError("account_unbound");
}

async function loadInvoice(invoiceId: string): Promise<InvoiceDoc> {
  const head = await (await getInvoices()).findOne({ _id: invoiceId });
  if (!head) throw new InvoiceNotFoundError();
  return head;
}

async function loadVersion(
  invoiceId: string,
  version: number,
): Promise<InvoiceVersionDoc> {
  const doc = await (await getInvoiceVersions()).findOne({
    _id: versionId(invoiceId, version),
  });
  if (!doc) throw new InvoiceNotFoundError();
  return doc;
}

async function activeAllocationCount(invoiceId: string): Promise<number> {
  return (await getSettlementAllocations()).countDocuments({
    invoiceId,
    reversedAt: null,
  });
}

async function openIntentCount(invoiceId: string, now: Date): Promise<number> {
  return (await getPaymentIntents()).countDocuments({
    invoiceId,
    state: "open",
    expiresAt: { $gt: now },
  });
}

async function insertNextVersion(
  head: InvoiceDoc,
  version: InvoiceVersionDoc,
  headUpdate: Record<string, unknown>,
  allowedStates: InvoiceState[],
): Promise<InvoiceDoc> {
  const versions = await getInvoiceVersions();
  try {
    await versions.insertOne(version);
  } catch (error) {
    if (isDuplicateKey(error)) throw new InvoiceConflictError();
    throw error;
  }
  const updated = await (await getInvoices()).findOneAndUpdate(
    {
      _id: head._id,
      currentVersion: head.currentVersion,
      state: { $in: allowedStates },
    },
    {
      $set: {
        ...headUpdate,
        currentVersion: version.version,
        amountDue: version.amountDue,
        updatedAt: new Date(),
      },
      $inc: { projectionRevision: 1 },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    await versions.deleteOne({ _id: version._id });
    throw new InvoiceConflictError();
  }
  return updated;
}

export async function createInvoice(
  privyUserId: string,
  input: CreateInvoiceInput,
): Promise<InvoiceSummaryOutput> {
  const { business } = await assertManager(privyUserId, input.businessId);
  assertInvoicingBusiness(business);
  await requireSubmission(privyUserId);
  const now = new Date();
  const invoiceId = newOpaqueId();
  const version = buildVersion({
    invoiceId,
    businessId: business._id,
    version: 1,
    amountDue: BigInt(input.amountDue),
    issuedAt: now,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    encryptedContent: input.encryptedContent,
    wrappedKey: input.wrappedKey,
    contentCommitment: input.contentCommitment,
    createdBy: privyUserId,
  });
  const number = await nextInvoiceNumber(business._id);
  const head: InvoiceDoc = {
    _id: invoiceId,
    businessId: business._id,
    number,
    currentVersion: 1,
    state: input.issue ? "issued" : "draft",
    amountDue: version.amountDue,
    allocatedAmount: 0n,
    refundedAmount: 0n,
    appliedAllocationIds: [],
    projectionRevision: 0,
    issuedAt: input.issue ? now : null,
    cancelledAt: null,
    voidedAt: null,
    erasedAt: null,
    createdBy: privyUserId,
    createdAt: now,
    updatedAt: now,
  };
  const versions = await getInvoiceVersions();
  await versions.insertOne(version);
  try {
    await (await getInvoices()).insertOne(head);
  } catch (error) {
    await versions.deleteOne({ _id: version._id });
    throw error;
  }
  await appendEvent({
    invoice: head,
    kind: input.issue ? "issued" : "created",
    version: 1,
    amount: version.amountDue,
    actor: privyUserId,
  });
  await recordAudit({
    actor: privyUserId,
    action: input.issue ? "invoice.issued" : "invoice.created",
    businessId: business._id,
    reasonCode: `invoice:${invoiceId}:v1`,
  });
  return toSummaryOutput(head, version);
}

async function managedInvoice(privyUserId: string, invoiceId: string) {
  const head = await loadInvoice(invoiceId);
  const { business } = await assertManager(privyUserId, head.businessId);
  return { head, business };
}

export async function reviseInvoice(
  privyUserId: string,
  input: ReviseInvoiceInput,
): Promise<InvoiceSummaryOutput> {
  const { head, business } = await managedInvoice(privyUserId, input.invoiceId);
  assertInvoicingBusiness(business);
  await requireSubmission(privyUserId);
  if (head.erasedAt) throw new InvoiceStateError("erased");
  if (!REVISABLE_STATES.includes(head.state))
    throw new InvoiceStateError("not_revisable");
  if (head.currentVersion !== input.expectedVersion)
    throw new InvoiceConflictError();
  if ((await activeAllocationCount(head._id)) > 0)
    throw new InvoiceStateError("has_allocations");
  const now = new Date();
  if ((await openIntentCount(head._id, now)) > 0)
    throw new InvoiceStateError("payment_in_progress");
  const version = buildVersion({
    invoiceId: head._id,
    businessId: head.businessId,
    version: head.currentVersion + 1,
    amountDue: BigInt(input.amountDue),
    issuedAt: now,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    encryptedContent: input.encryptedContent,
    wrappedKey: input.wrappedKey,
    contentCommitment: input.contentCommitment,
    createdBy: privyUserId,
  });
  const updated = await insertNextVersion(head, version, {}, REVISABLE_STATES);
  await appendEvent({
    invoice: head,
    kind: "revised",
    version: version.version,
    amount: version.amountDue,
    actor: privyUserId,
  });
  await recordAudit({
    actor: privyUserId,
    action: "invoice.revised",
    businessId: head.businessId,
    reasonCode: `invoice:${head._id}:v${version.version}`,
  });
  return toSummaryOutput(updated, version);
}

export async function issueInvoice(
  privyUserId: string,
  input: IssueInvoiceInput,
): Promise<InvoiceSummaryOutput> {
  const { head, business } = await managedInvoice(privyUserId, input.invoiceId);
  assertInvoicingBusiness(business);
  await requireSubmission(privyUserId);
  if (head.erasedAt) throw new InvoiceStateError("erased");
  if (head.state !== "draft") throw new InvoiceStateError("not_draft");
  if (head.currentVersion !== input.expectedVersion)
    throw new InvoiceConflictError();
  const draft = await loadVersion(head._id, head.currentVersion);
  const now = new Date();
  const version = buildVersion({
    invoiceId: head._id,
    businessId: head.businessId,
    version: head.currentVersion + 1,
    amountDue: draft.amountDue,
    issuedAt: now,
    dueAt: draft.dueAt,
    encryptedContent: draft.encryptedContent,
    wrappedKey: draft.wrappedKey,
    contentCommitment: draft.contentCommitment,
    createdBy: privyUserId,
  });
  const updated = await insertNextVersion(
    head,
    version,
    { state: "issued", issuedAt: now },
    ["draft"],
  );
  await appendEvent({
    invoice: head,
    kind: "issued",
    version: version.version,
    amount: version.amountDue,
    actor: privyUserId,
  });
  await recordAudit({
    actor: privyUserId,
    action: "invoice.issued",
    businessId: head.businessId,
    reasonCode: `invoice:${head._id}:v${version.version}`,
  });
  return toSummaryOutput(updated, version);
}

export async function cancelInvoice(
  privyUserId: string,
  invoiceId: string,
): Promise<InvoiceSummaryOutput> {
  const { head } = await managedInvoice(privyUserId, invoiceId);
  const now = new Date();
  let set: Partial<InvoiceDoc>;
  if (head.state === "draft") set = { state: "void", voidedAt: now };
  else if (PAYABLE_STATES.includes(head.state))
    set = { state: "cancelled", cancelledAt: now };
  else throw new InvoiceStateError("not_cancellable");
  const updated = await (await getInvoices()).findOneAndUpdate(
    { _id: head._id, state: head.state },
    { $set: { ...set, updatedAt: now }, $inc: { projectionRevision: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) throw new InvoiceConflictError();
  await appendEvent({
    invoice: head,
    kind: "cancelled",
    version: head.currentVersion,
    actor: privyUserId,
  });
  await recordAudit({
    actor: privyUserId,
    action: set.state === "void" ? "invoice.voided" : "invoice.cancelled",
    businessId: head.businessId,
    reasonCode: `invoice:${head._id}`,
  });
  return toSummaryOutput(
    updated,
    await loadVersion(head._id, updated.currentVersion),
  );
}

export async function eraseInvoice(
  privyUserId: string,
  invoiceId: string,
): Promise<InvoiceSummaryOutput> {
  const { head } = await managedInvoice(privyUserId, invoiceId);
  const now = new Date();
  await (await getInvoiceVersions()).updateMany(
    { invoiceId: head._id },
    { $set: { encryptedContent: null, wrappedKey: null } },
  );
  const updated = await (await getInvoices()).findOneAndUpdate(
    { _id: head._id },
    { $set: { erasedAt: head.erasedAt ?? now, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) throw new InvoiceNotFoundError();
  if (!head.erasedAt) {
    await appendEvent({
      invoice: head,
      kind: "erased",
      actor: privyUserId,
    });
    await recordAudit({
      actor: privyUserId,
      action: "invoice.erased",
      businessId: head.businessId,
      reasonCode: `invoice:${head._id}`,
    });
  }
  return toSummaryOutput(
    updated,
    await loadVersion(head._id, updated.currentVersion),
  );
}

export async function listInvoices(
  privyUserId: string,
  input: ListInvoicesInput,
): Promise<InvoiceListOutput> {
  await assertMember(privyUserId, input.businessId);
  const heads = await (await getInvoices())
    .find({
      businessId: input.businessId,
      ...(input.state ? { state: input.state } : {}),
      ...(input.beforeNumber ? { number: { $lt: input.beforeNumber } } : {}),
    })
    .sort({ number: -1 })
    .limit(input.limit + 1)
    .toArray();
  const page = heads.slice(0, input.limit);
  const versions = await (await getInvoiceVersions())
    .find({ _id: { $in: page.map((h) => versionId(h._id, h.currentVersion)) } })
    .toArray();
  const byId = new Map(versions.map((v) => [v._id, v]));
  return {
    items: page.flatMap((head) => {
      const current = byId.get(versionId(head._id, head.currentVersion));
      return current ? [toSummaryOutput(head, current)] : [];
    }),
    nextBeforeNumber:
      heads.length > input.limit ? (page.at(-1)?.number ?? null) : null,
  };
}

export async function refundSharesForSettlements(
  settlementIds: string[],
): Promise<Map<string, bigint>> {
  const shares = new Map<string, bigint>();
  if (settlementIds.length === 0) return shares;
  const unique = [...new Set(settlementIds)];
  const [settlements, allocations] = await Promise.all([
    (await getSettlements()).find({ _id: { $in: unique } }).toArray(),
    (await getSettlementAllocations())
      .find({ settlementId: { $in: unique }, reversedAt: null })
      .toArray(),
  ]);
  for (const settlement of settlements) {
    const applied = allocations
      .filter(
        (a) =>
          a.settlementId === settlement._id &&
          settlement.appliedAllocationIds.includes(a._id),
      )
      .map((a) => ({
        id: a._id,
        invoiceId: a.invoiceId,
        amount: a.amount,
        createdAt: a.createdAt,
      }));
    for (const [id, share] of refundSharesByAllocation(settlement, applied))
      shares.set(id, share);
  }
  return shares;
}

function appliedToInvoice(
  head: InvoiceDoc,
  allocation: SettlementAllocationDoc,
): boolean {
  return (
    allocation.reversedAt === null &&
    head.appliedAllocationIds.includes(allocation._id)
  );
}

export async function recomputeInvoice(
  invoiceId: string,
): Promise<InvoiceDoc | null> {
  const invoices = await getInvoices();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const head = await invoices.findOne({ _id: invoiceId });
    if (!head) return null;
    const allocations = (
      await (await getSettlementAllocations()).find({ invoiceId }).toArray()
    ).filter((a) => appliedToInvoice(head, a));
    const shares = await refundSharesForSettlements(
      allocations.map((a) => a.settlementId),
    );
    const allocatedAmount = allocations.reduce((s, a) => s + a.amount, 0n);
    const refundedAmount = allocations.reduce(
      (s, a) => s + (shares.get(a._id) ?? 0n),
      0n,
    );
    const state = deriveInvoiceState({
      draft: head.issuedAt === null,
      cancelled: head.cancelledAt !== null,
      voided: head.voidedAt !== null,
      amountDue: head.amountDue,
      allocated: allocatedAmount,
      refunded: refundedAmount,
    });
    if (
      head.allocatedAmount === allocatedAmount &&
      head.refundedAmount === refundedAmount &&
      head.state === state
    ) {
      return head;
    }
    const now = new Date();
    const result = await invoices.updateOne(
      { _id: invoiceId, projectionRevision: head.projectionRevision },
      {
        $set: { allocatedAmount, refundedAmount, state, updatedAt: now },
        $inc: { projectionRevision: 1 },
      },
    );
    if (result.matchedCount === 1) {
      return {
        ...head,
        allocatedAmount,
        refundedAmount,
        state,
        updatedAt: now,
        projectionRevision: head.projectionRevision + 1,
      };
    }
  }
  throw new InvoiceConflictError();
}

export async function getInvoice(
  privyUserId: string,
  invoiceId: string,
): Promise<InvoiceDetailOutput> {
  const head = await loadInvoice(invoiceId);
  await assertMember(privyUserId, head.businessId);
  const [versions, allocations, events, intents] = await Promise.all([
    (await getInvoiceVersions())
      .find({ invoiceId })
      .sort({ version: 1 })
      .toArray(),
    (await getSettlementAllocations())
      .find({ invoiceId })
      .sort({ createdAt: 1 })
      .toArray(),
    (await getInvoiceEvents())
      .find({ invoiceId })
      .sort({ at: 1, _id: 1 })
      .limit(500)
      .toArray(),
    (await getPaymentIntents())
      .find({ invoiceId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
  ]);
  const current = versions.find((v) => v.version === head.currentVersion);
  if (!current) throw new InvoiceNotFoundError();
  const settlementIds = allocations.map((a) => a.settlementId);
  const [settlements, shares] = await Promise.all([
    (await getSettlements()).find({ _id: { $in: settlementIds } }).toArray(),
    refundSharesForSettlements(settlementIds),
  ]);
  const bySettlement = new Map(settlements.map((s) => [s._id, s]));
  return {
    ...toSummaryOutput(head, current),
    versions: versions.map(toVersionOutput),
    allocations: allocations.map((a) => {
      const settlement = bySettlement.get(a.settlementId);
      return {
        allocationId: a._id,
        settlementId: a.settlementId,
        invoiceVersion: a.invoiceVersion,
        amount: a.amount.toString(),
        refundedAmount: (appliedToInvoice(head, a)
          ? (shares.get(a._id) ?? 0n)
          : 0n
        ).toString(),
        createdAt: a.createdAt.toISOString(),
        appliedAt: iso(a.appliedAt),
        reversedAt: iso(a.reversedAt),
        txHash: settlement?.txHash ?? null,
        ledgerClosedAt: iso(settlement?.ledgerClosedAt),
        rail: settlement?.rail ?? null,
      };
    }),
    events: events.map((e) => ({
      kind: e.kind,
      version: e.version,
      amount: e.amount === null ? null : e.amount.toString(),
      settlementId: e.settlementId,
      at: e.at.toISOString(),
    })),
    intents: intents.map((i) => ({
      intentId: i._id,
      invoiceVersion: i.invoiceVersion,
      channel: i.channel,
      state:
        i.state === "open" && i.expiresAt.getTime() <= Date.now()
          ? "expired"
          : i.state,
      amount: i.amount.toString(),
      payerSentAt: iso(i.railRefs.payerSentAt),
      settledAt: iso(i.settledAt),
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

export async function publicInvoiceView(
  invoiceId: string,
): Promise<PublicInvoiceOutput> {
  const head = await (await getInvoices()).findOne({ _id: invoiceId });
  if (!head || head.state === "draft" || head.state === "void") return null;
  const [current, business] = await Promise.all([
    (await getInvoiceVersions()).findOne({
      _id: versionId(head._id, head.currentVersion),
    }),
    (await getBusinessProfiles()).findOne({ _id: head.businessId }),
  ]);
  if (!current || !business) return null;
  return {
    invoiceId: head._id,
    number: head.number,
    version: current.version,
    state: head.state,
    payable:
      PAYABLE_STATES.includes(head.state) &&
      head.erasedAt === null &&
      business.lifecycle === "active",
    amountDue: current.amountDue.toString(),
    remainingAmount: remainingDue(head).toString(),
    network: current.network,
    asset: current.asset,
    issuedAt: current.issuedAt.toISOString(),
    dueAt: iso(current.dueAt),
    encryptedContent: current.encryptedContent,
    contentCommitment: current.contentCommitment,
    invoiceCommitment: current.invoiceCommitment,
    business: { displayName: business.displayName },
  };
}

export async function payableInvoice(
  invoiceId: string,
  version: number,
  recipientOwner: string,
): Promise<{ head: InvoiceDoc; version: InvoiceVersionDoc }> {
  const head = await loadInvoice(invoiceId);
  if (head.erasedAt || !PAYABLE_STATES.includes(head.state))
    throw new InvoiceStateError("not_payable");
  if (head.currentVersion !== version) throw new InvoiceConflictError();
  const business = await (await getBusinessProfiles()).findOne({
    _id: head.businessId,
  });
  if (business?.lifecycle !== "active")
    throw new InvoiceStateError("business_inactive");
  if (business.boundAccount !== recipientOwner)
    throw new InvoiceStateError("wrong_recipient");
  const current = await loadVersion(head._id, version);
  const config = invoiceConfig();
  if (current.network !== config.network || current.poolId !== config.poolId)
    throw new InvoiceStateError("network_mismatch");
  return { head, version: current };
}

export async function assertLinkableInvoice(
  privyUserId: string,
  invoiceId: string,
  username: string,
): Promise<void> {
  const head = await loadInvoice(invoiceId);
  const { business } = await assertManager(privyUserId, head.businessId);
  if (business.username !== username)
    throw new InvoiceStateError("wrong_recipient");
  if (head.erasedAt || !PAYABLE_STATES.includes(head.state))
    throw new InvoiceStateError("not_payable");
}

export async function invoiceStates(
  invoiceIds: string[],
): Promise<Map<string, InvoiceState>> {
  if (invoiceIds.length === 0) return new Map();
  const heads = await (await getInvoices())
    .find({ _id: { $in: [...new Set(invoiceIds)] } })
    .project<{ _id: string; state: InvoiceState }>({ state: 1 })
    .toArray();
  return new Map(heads.map((h) => [h._id, h.state]));
}
