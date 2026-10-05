#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const USAGE = `Usage: verification-cases.mjs <command> [options]

  list [--eligibility=STATE] [--limit=N]   Summarize cases (default: manual_review; also open | all)
  events [--state=STATE] [--limit=N]       Summarize notifications (default: parked; also queued | done | all)
  inspect <caseId>                         Show one case without provider payload internals
  reconcile <caseId> --reason=TEXT         Ask the worker to re-check the case now (audited)
  requeue-event <eventId> --reason=TEXT    Return a parked notification to the queue (audited)
  suspend <businessId> --reason=TEXT       Suspend and unpublish the current credential (audited)

There is no approve command. Approval only comes from reconciling provider evidence through policy.
Environment: MONGODB_URI, VERIFICATION_OPERATOR=<operator identifier for audit records>`;

const OPEN_STATES = [
  "pending",
  "needs_information",
  "manual_review",
  "not_started",
];

function option(argv, name, fallback) {
  const found = argv.find((value) => value.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const isId = (value) => /^[A-Za-z0-9_:-]{8,128}$/.test(value ?? "");

export function summarizeCase(doc, now = Date.now()) {
  return {
    caseId: doc._id,
    businessId: doc.businessId,
    environment: doc.environment,
    applicantType: doc.applicantType,
    eligibility: doc.eligibility,
    reviewStatus: doc.snapshot?.reviewStatus ?? null,
    reviewAnswer: doc.snapshot?.reviewAnswer ?? null,
    rejectType: doc.snapshot?.rejectType ?? null,
    internalReasons: doc.internalReasons ?? [],
    revision: doc.revision,
    reviewCycle: doc.reviewCycle,
    providerCheckedAgeMinutes: doc.providerCheckedAt
      ? Math.round((now - new Date(doc.providerCheckedAt).getTime()) / 60_000)
      : null,
    reconcileInSeconds: Math.round(
      (new Date(doc.reconcileAt).getTime() - now) / 1000,
    ),
    leased: Boolean(doc.leaseUntil && new Date(doc.leaseUntil).getTime() > now),
  };
}

export function summarizeEvent(doc, now = Date.now()) {
  return {
    eventId: doc._id,
    environment: doc.environment,
    type: doc.type,
    externalUserId: doc.externalUserId,
    reviewStatus: doc.reviewStatus,
    reviewAnswer: doc.reviewAnswer,
    state: doc.state,
    attempts: doc.attempts,
    lastError: doc.lastError ?? null,
    caseId: doc.caseId ?? null,
    ageMinutes: Math.round((now - new Date(doc.receivedAt).getTime()) / 60_000),
  };
}

export function reconcileUpdate(now = new Date()) {
  return { $set: { reconcileAt: now, updatedAt: now } };
}

export function requeueEventUpdate(event, now = new Date()) {
  if (event.state !== "parked") {
    throw new Error(
      `Event is in state ${event.state}; only parked events can be requeued.`,
    );
  }
  return {
    $set: { state: "queued", attempts: 0, nextAttemptAt: now },
    $unset: { lastError: "", leaseOwner: "", leaseUntil: "" },
  };
}

export function suspendUpdate(reason, now = new Date()) {
  return {
    $set: {
      status: "suspended",
      suspensionReason: `operator:${reason}`,
      published: false,
      updatedAt: now,
    },
  };
}

function auditRecord(actor, action, businessId, caseId, reasonCode) {
  return {
    _id: randomBytes(16).toString("base64url"),
    actor,
    action,
    caseId: caseId ?? null,
    businessId,
    fromRevision: null,
    toRevision: null,
    reasonCode,
    at: new Date(),
  };
}

function requireReason(argv, command) {
  const reason = option(argv, "--reason", "").trim();
  if (!reason) throw new Error(`${command} requires --reason=TEXT.`);
  return reason.slice(0, 200);
}

export async function run(argv, db, env = process.env, out = console.log) {
  const [command, target] = argv.filter((value) => !value.startsWith("--"));
  const actor = `operator:${env.VERIFICATION_OPERATOR || "unknown"}`;
  const cases = db.collection("verification_cases");
  const events = db.collection("verification_events");
  const credentials = db.collection("identity_credentials");
  const audit = db.collection("verification_audit");
  const limit = Math.min(
    500,
    Math.max(1, Number(option(argv, "--limit", "50")) || 50),
  );

  if (command === "list") {
    const eligibility = option(argv, "--eligibility", "manual_review");
    const filter =
      eligibility === "open"
        ? { eligibility: { $in: OPEN_STATES } }
        : eligibility === "all"
          ? {}
          : { eligibility };
    const items = await cases
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
    const counts = Object.fromEntries(
      (
        await cases
          .aggregate([{ $group: { _id: "$eligibility", count: { $sum: 1 } } }])
          .toArray()
      ).map((row) => [row._id, row.count]),
    );
    out(
      JSON.stringify(
        { counts, cases: items.map((d) => summarizeCase(d)) },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "events") {
    const state = option(argv, "--state", "parked");
    const filter = state === "all" ? {} : { state };
    const items = await events
      .find(filter)
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();
    out(
      JSON.stringify({ events: items.map((d) => summarizeEvent(d)) }, null, 2),
    );
    return 0;
  }
  if (command === "inspect") {
    if (!isId(target)) throw new Error("inspect requires a case id.");
    const doc = await cases.findOne({ _id: target });
    if (!doc) throw new Error("Case not found.");
    const { snapshot, externalUserId, ...rest } = doc;
    const credential = await credentials.findOne({
      businessId: doc.businessId,
      environment: doc.environment,
    });
    const history = await audit
      .find({ caseId: target })
      .sort({ at: -1 })
      .limit(20)
      .toArray();
    out(
      JSON.stringify(
        {
          ...rest,
          externalUserId: `${externalUserId.slice(0, 12)}…`,
          snapshot: snapshot
            ? {
                reviewStatus: snapshot.reviewStatus,
                reviewAnswer: snapshot.reviewAnswer,
                rejectType: snapshot.rejectType,
                rejectLabelCount: snapshot.rejectLabels?.length ?? 0,
                evidenceComplete: snapshot.evidenceComplete,
                pendingEvidence: snapshot.pendingEvidence,
                associatedPersons: (snapshot.associatedPersons ?? []).map(
                  (p) => ({
                    role: p.role,
                    reviewStatus: p.reviewStatus,
                    reviewAnswer: p.reviewAnswer,
                  }),
                ),
                checkedAt: snapshot.checkedAt,
              }
            : null,
          credential: credential
            ? {
                status: credential.status,
                published: credential.published,
                checkedAt: credential.checkedAt,
                validUntil: credential.validUntil,
                suspensionReason: credential.suspensionReason,
              }
            : null,
          audit: history,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "reconcile") {
    if (!isId(target)) throw new Error("reconcile requires a case id.");
    const reason = requireReason(argv, command);
    const doc = await cases.findOne({ _id: target });
    if (!doc) throw new Error("Case not found.");
    await cases.updateOne({ _id: target }, reconcileUpdate(), {
      writeConcern: { w: "majority", j: true },
    });
    await audit.insertOne(
      auditRecord(
        actor,
        "operator.reconcile_requested",
        doc.businessId,
        target,
        reason,
      ),
    );
    out(
      JSON.stringify(
        summarizeCase(await cases.findOne({ _id: target })),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "requeue-event") {
    if (!isId(target)) throw new Error("requeue-event requires an event id.");
    const reason = requireReason(argv, command);
    const event = await events.findOne({ _id: target });
    if (!event) throw new Error("Event not found.");
    const result = await events.updateOne(
      { _id: target, state: "parked" },
      requeueEventUpdate(event),
      { writeConcern: { w: "majority", j: true } },
    );
    if (result.matchedCount !== 1)
      throw new Error("Event changed before the update; inspect it again.");
    const related = event.caseId
      ? await cases.findOne({ _id: event.caseId })
      : null;
    await audit.insertOne(
      auditRecord(
        actor,
        "operator.event_requeued",
        related?.businessId ?? "unknown",
        related?._id ?? null,
        reason,
      ),
    );
    out(
      JSON.stringify(
        summarizeEvent(await events.findOne({ _id: target })),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "suspend") {
    if (!isId(target)) throw new Error("suspend requires a business id.");
    const reason = requireReason(argv, command);
    const result = await credentials.updateMany(
      { businessId: target, status: "active" },
      suspendUpdate(reason),
      { writeConcern: { w: "majority", j: true } },
    );
    const related = await cases.findOne({ businessId: target });
    await audit.insertOne(
      auditRecord(
        actor,
        "operator.credential_suspended",
        target,
        related?._id ?? null,
        reason,
      ),
    );
    out(
      JSON.stringify(
        { businessId: target, suspended: result.modifiedCount },
        null,
        2,
      ),
    );
    return 0;
  }
  out(USAGE);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/olio";
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  let code = 1;
  try {
    await client.connect();
    code = await run(process.argv.slice(2), client.db());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    await client.close().catch(() => {});
  }
  process.exit(code);
}
