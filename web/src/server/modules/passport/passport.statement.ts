import "server-only";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../../../lib/crypto";
import { canonicalJson, type Json } from "../../../lib/invoiceCrypto";
import { poolId, stellarNetwork } from "../../../lib/stellar";
import {
  getBusinessProfiles,
  getIdentityCredentials,
  getPassportStatements,
  getSettlements,
  type PassportPayerMask,
  type PassportStatementDetail,
  type PassportStatementDoc,
  type PassportStatementPeriod,
  type SettlementDoc,
} from "../../db/mongo";
import { rateLimit } from "../../lib/rateLimit";
import {
  assertManager,
  newOpaqueId,
  recordAudit,
} from "../businesses/businesses.service";
import {
  credentialBacksNetwork,
  type RecordsGate,
  type RecordsReason,
  recordsGate,
} from "../evidence/evidence.gate";
import { QUALIFICATION_POLICY_VERSION } from "../settlements/settlements.policy";
import { invoiceRefsFor } from "../settlements/settlements.service";
import { verificationConfig } from "../verification/verification.config";
import type {
  IssueStatementInput,
  PassportStatement,
  StatementListItem,
  StatementMonth,
  StatementOutput,
  StatementRow,
  VerifyStatementOutput,
} from "./passport.schema";

export const STATEMENT_KIND = "olio.passport.statement";
export const STATEMENT_VERSION = 1;
export const STATEMENT_TTL_DAYS = 90;
export const MAX_STATEMENT_ROWS = 1000;
export const VERIFY_PATH = "/verify";

const ISSUE_LIMIT = 20;
const ISSUE_WINDOW_MS = 60 * 60_000;
const PERIOD_MONTHS: Record<Exclude<PassportStatementPeriod, "all">, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

export type StatementErrorCode =
  | "syncing"
  | "records_on_hold"
  | "not_eligible"
  | "too_many_rows"
  | "not_found"
  | "throttled";

function utcTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export class PassportStatementError extends Error {
  constructor(
    public readonly code: StatementErrorCode,
    public readonly retryAfterMs = 0,
    recordsAsOf: Date | null = null,
  ) {
    super(
      code === "syncing"
        ? recordsAsOf
          ? `Payments after ${utcTime(recordsAsOf)} are still syncing. Try again in a few minutes.`
          : "Olio is still syncing your payments. Try again in a few minutes."
        : code === "records_on_hold"
          ? "Olio's payment records failed a consistency check, so statements are on hold until it is fixed."
          : code === "not_eligible"
            ? "Payment statements need a current identity verification for this business."
            : code === "too_many_rows"
              ? `This period has more than ${MAX_STATEMENT_ROWS} payments. Choose a shorter period or the monthly summary.`
              : code === "throttled"
                ? "Too many statements requested. Try again in a moment."
                : "Statement not found.",
    );
    this.name = "PassportStatementError";
  }
}

export function verifyPathFor(statementId: string): string {
  return `${VERIFY_PATH}/${statementId}`;
}

export function newStatementId(): string {
  return `pst_${newOpaqueId(16)}`;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Periods start on the first day of a UTC month so each monthly bucket covers
 * a whole month, except the current one, which ends at issuance.
 */
export function periodStart(
  preset: PassportStatementPeriod,
  now: Date,
  earliest: Date | null,
): Date {
  if (preset === "all") return startOfMonth(earliest ?? now);
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (PERIOD_MONTHS[preset] - 1),
      1,
    ),
  );
}

export function monthsBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  let cursor = startOfMonth(from);
  while (cursor <= to) {
    keys.push(monthKey(cursor));
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    );
  }
  return keys;
}

export function maskPayer(
  payer: string | null,
  mask: PassportPayerMask,
): string | null {
  if (payer === null || mask === "hidden") return null;
  if (mask === "full" || payer.length <= 10) return payer;
  return `${payer.slice(0, 4)}…${payer.slice(-4)}`;
}

export type ActivitySettlement = Pick<
  SettlementDoc,
  | "_id"
  | "amount"
  | "refundedAmount"
  | "payer"
  | "ledgerClosedAt"
  | "rail"
  | "txHash"
  | "evidenceLevel"
  | "qualification"
>;

export type Activity = {
  summary: PassportStatement["summary"];
  months: StatementMonth[];
  rows: StatementRow[] | null;
};

/**
 * Totals count only qualified settlements (not self-funded, not fully
 * refunded), net of partial refunds. Everything else is left out and counted
 * in `excludedCount` so the reader knows something was omitted.
 */
export function summarizeActivity(
  settlements: ActivitySettlement[],
  options: {
    from: Date;
    to: Date;
    detail: PassportStatementDetail;
    payerMask: PassportPayerMask;
    invoiceNumbers?: Map<string, number[]>;
  },
): Activity {
  const months = new Map(
    monthsBetween(options.from, options.to).map((key) => [
      key,
      { count: 0, amount: 0n },
    ]),
  );
  const payers = new Set<string>();
  const rows: StatementRow[] = [];
  let total = 0n;
  let count = 0;
  let excluded = 0;
  const ordered = [...settlements].sort(
    (a, b) => a.ledgerClosedAt.getTime() - b.ledgerClosedAt.getTime(),
  );
  for (const settlement of ordered) {
    if (
      settlement.ledgerClosedAt < options.from ||
      settlement.ledgerClosedAt > options.to
    )
      continue;
    if (!settlement.qualification.counted || settlement.amount === null) {
      excluded += 1;
      continue;
    }
    const net = settlement.amount - settlement.refundedAmount;
    total += net;
    count += 1;
    if (settlement.payer) payers.add(settlement.payer);
    const bucket = months.get(monthKey(settlement.ledgerClosedAt));
    if (bucket) {
      bucket.count += 1;
      bucket.amount += net;
    }
    if (options.detail === "full") {
      rows.push({
        date: settlement.ledgerClosedAt.toISOString(),
        amount: settlement.amount.toString(),
        refunded: settlement.refundedAmount.toString(),
        rail: settlement.rail,
        invoices: options.invoiceNumbers?.get(settlement._id) ?? [],
        txHash: settlement.txHash,
        evidenceLevel: settlement.evidenceLevel,
        payer: maskPayer(settlement.payer, options.payerMask),
      });
    }
  }
  return {
    summary: {
      totalReceived: total.toString(),
      paymentCount: count,
      distinctPayers: payers.size,
      excludedCount: excluded,
    },
    months: [...months].map(([month, bucket]) => ({
      month,
      count: bucket.count,
      amount: bucket.amount.toString(),
    })),
    rows: options.detail === "full" ? rows : null,
  };
}

export async function collectActivity(
  businessId: string,
  from: Date,
  to: Date,
  detail: PassportStatementDetail,
  payerMask: PassportPayerMask,
): Promise<Activity> {
  const settlements = (await (
    await getSettlements()
  )
    .find({
      businessId,
      network: stellarNetwork,
      poolId,
      ledgerClosedAt: { $gte: from, $lte: to },
    })
    .project({
      amount: 1,
      refundedAmount: 1,
      payer: 1,
      ledgerClosedAt: 1,
      rail: 1,
      txHash: 1,
      evidenceLevel: 1,
      qualification: 1,
    })
    .toArray()) as ActivitySettlement[];
  let invoiceNumbers: Map<string, number[]> | undefined;
  if (detail === "full") {
    const counted = settlements.filter(
      (s) => s.qualification.counted && s.amount !== null,
    );
    if (counted.length > MAX_STATEMENT_ROWS)
      throw new PassportStatementError("too_many_rows");
    const refs = await invoiceRefsFor(counted.map((s) => s._id));
    invoiceNumbers = new Map(
      [...refs].map(([id, list]) => [
        id,
        list.map((ref) => ref.number).sort((a, b) => a - b),
      ]),
    );
  }
  return summarizeActivity(settlements, {
    from,
    to,
    detail,
    payerMask,
    invoiceNumbers,
  });
}

export function statementDigest(statement: PassportStatement): string {
  return bytesToHex(
    sha256(new TextEncoder().encode(canonicalJson(statement as Json))),
  );
}

const HELD_REASONS = new Set<RecordsReason>([
  "pool_index_degraded",
  "pool_roots_mismatch",
  "reconcile_degraded",
]);

/**
 * A statement presents the payment history as complete, so it is only issued
 * once the settlement ledger mirrors every published pool deposit. Records
 * that are merely behind say so with the time they are current to; records
 * that failed a consistency check are held until someone repairs them.
 */
export function assertRecordsComplete(gate: RecordsGate): Date {
  if (gate.open && gate.asOf) return gate.asOf;
  if (gate.reasons.some((reason) => HELD_REASONS.has(reason)))
    throw new PassportStatementError("records_on_hold");
  throw new PassportStatementError("syncing", 0, gate.asOf);
}

export function statementStatus(
  doc: Pick<PassportStatementDoc, "revokedAt" | "expiresAt">,
  now = new Date(),
): StatementListItem["status"] {
  if (doc.revokedAt) return "revoked";
  if (doc.expiresAt <= now) return "expired";
  return "valid";
}

function periodOutput(period: PassportStatementDoc["period"]) {
  return {
    preset: period.preset,
    from: period.from.toISOString(),
    to: period.to.toISOString(),
  };
}

export async function issueStatement(
  privyUserId: string,
  input: IssueStatementInput,
  now = new Date(),
): Promise<StatementOutput> {
  const { business } = await assertManager(privyUserId, input.businessId);
  const config = verificationConfig();
  const credential = config.environment
    ? await (await getIdentityCredentials()).findOne({
        businessId: business._id,
        environment: config.environment,
      })
    : null;
  if (
    business.lifecycle !== "active" ||
    !credentialBacksNetwork(credential, now, stellarNetwork, config)
  )
    throw new PassportStatementError("not_eligible");

  const recordsAsOf = assertRecordsComplete(await recordsGate());

  const { ok, retryAfterMs } = rateLimit(
    `passport:statement:${business._id}`,
    ISSUE_LIMIT,
    ISSUE_WINDOW_MS,
  );
  if (!ok) throw new PassportStatementError("throttled", retryAfterMs);

  const earliest =
    input.period === "all"
      ? ((
          await (
            await getSettlements()
          ).findOne(
            { businessId: business._id, network: stellarNetwork, poolId },
            { sort: { ledgerClosedAt: 1 }, projection: { ledgerClosedAt: 1 } },
          )
        )?.ledgerClosedAt ?? null)
      : null;
  const from = periodStart(input.period, now, earliest);
  const payerMask = input.detail === "full" ? input.payerMask : null;
  const activity = await collectActivity(
    business._id,
    from,
    now,
    input.detail,
    payerMask ?? "hidden",
  );

  const statementId = newStatementId();
  const expiresAt = new Date(
    now.getTime() + STATEMENT_TTL_DAYS * 24 * 60 * 60_000,
  );
  const statement: PassportStatement = {
    kind: STATEMENT_KIND,
    version: STATEMENT_VERSION,
    statementId,
    issuer: "olio",
    network: stellarNetwork,
    poolId,
    business: {
      displayName: business.displayName,
      type: business.type,
      verified: true,
      checkedAt: credential.checkedAt.toISOString(),
      validUntil: credential.validUntil.toISOString(),
    },
    period: {
      preset: input.period,
      from: from.toISOString(),
      to: now.toISOString(),
    },
    detail: input.detail,
    payerMask,
    summary: activity.summary,
    months: activity.months,
    rows: activity.rows,
    qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
    recordsAsOf: recordsAsOf.toISOString(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const digest = statementDigest(statement);

  await (await getPassportStatements()).insertOne({
    _id: statementId,
    businessId: business._id,
    network: stellarNetwork,
    poolId,
    version: STATEMENT_VERSION,
    businessName: business.displayName,
    digest,
    recordsAsOf,
    period: { preset: input.period, from, to: now },
    detail: input.detail,
    payerMask,
    summary: activity.summary,
    issuedBy: privyUserId,
    issuedAt: now,
    expiresAt,
    revokedAt: null,
    revokedBy: null,
  });
  await recordAudit({
    actor: privyUserId,
    action: "passport.statement_issued",
    businessId: business._id,
    reasonCode: input.detail,
  });

  return { statement, digest, verifyPath: verifyPathFor(statementId) };
}

export function toStatementListItem(
  doc: PassportStatementDoc,
  now = new Date(),
): StatementListItem {
  return {
    statementId: doc._id,
    status: statementStatus(doc, now),
    period: periodOutput(doc.period),
    detail: doc.detail,
    payerMask: doc.payerMask,
    summary: doc.summary,
    digest: doc.digest,
    issuedAt: doc.issuedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    revokedAt: doc.revokedAt?.toISOString() ?? null,
  };
}

export async function listStatements(
  privyUserId: string,
  businessId: string,
): Promise<StatementListItem[]> {
  await assertManager(privyUserId, businessId);
  const docs = await (await getPassportStatements())
    .find({ businessId })
    .sort({ issuedAt: -1 })
    .limit(20)
    .toArray();
  const now = new Date();
  return docs.map((doc) => toStatementListItem(doc, now));
}

export async function revokeStatement(
  privyUserId: string,
  businessId: string,
  statementId: string,
): Promise<StatementListItem> {
  await assertManager(privyUserId, businessId);
  const statements = await getPassportStatements();
  const now = new Date();
  const updated = await statements.findOneAndUpdate(
    { _id: statementId, businessId, revokedAt: null },
    { $set: { revokedAt: now, revokedBy: privyUserId } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const existing = await statements.findOne({ _id: statementId, businessId });
    if (!existing) throw new PassportStatementError("not_found");
    return toStatementListItem(existing, now);
  }
  await recordAudit({
    actor: privyUserId,
    action: "passport.statement_revoked",
    businessId,
    reasonCode: "owner_request",
  });
  return toStatementListItem(updated, now);
}

export async function verifyStatement(
  statementId: string,
  now = new Date(),
): Promise<VerifyStatementOutput> {
  const doc = await (await getPassportStatements()).findOne({
    _id: statementId,
  });
  if (!doc) return null;
  const config = verificationConfig();
  const [business, credential] = await Promise.all([
    (await getBusinessProfiles()).findOne({ _id: doc.businessId }),
    config.environment
      ? (await getIdentityCredentials()).findOne({
          businessId: doc.businessId,
          environment: config.environment,
        })
      : null,
  ]);
  return {
    statementId: doc._id,
    status: statementStatus(doc, now),
    businessName: doc.businessName,
    identityCurrent:
      business?.lifecycle === "active" &&
      credentialBacksNetwork(credential, now, doc.network, config),
    period: periodOutput(doc.period),
    detail: doc.detail,
    summary: doc.summary,
    digest: doc.digest,
    recordsAsOf: doc.recordsAsOf.toISOString(),
    issuedAt: doc.issuedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    revokedAt: doc.revokedAt?.toISOString() ?? null,
  };
}
