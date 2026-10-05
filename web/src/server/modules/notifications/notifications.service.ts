import "server-only";
import { TRPCError } from "@trpc/server";
import {
  getDb,
  getBusinessMemberships,
  getVerificationCases,
  type VerificationDelivery,
  type VerificationEnvironment,
} from "../../db/mongo";
import { verificationConfig } from "../verification/verification.config";
import { USER_MESSAGES } from "../verification/verification.policy";
type Notice = {
  _id: string;
  businessId: string;
  environment: VerificationEnvironment;
  kind: VerificationDelivery["kind"];
  at: Date;
  readBy: string[];
};
const notices = async () => (await getDb()).collection<Notice>("notifications");
const messages = {
  ...USER_MESSAGES,
  not_started: "Continue your verification.",
  submitted: "Your verification was received. You can now use your dashboard.",
};
export async function deliverNotifications(limit = 100) {
  const cases = await getVerificationCases();
  const pending = await cases
    .find({ "notificationOutbox.0": { $exists: true } })
    .limit(limit)
    .toArray();
  for (const doc of pending)
    for (const item of doc.notificationOutbox ?? []) {
      // Idempotent insert first, then acknowledge the embedded durable outbox.
      await (await notices()).updateOne(
        { _id: item.id },
        {
          $setOnInsert: {
            _id: item.id,
            businessId: doc.businessId,
            environment: doc.environment,
            kind: item.kind,
            at: item.at,
            readBy: [],
          },
        },
        { upsert: true, writeConcern: { w: "majority", j: true } },
      );
      await cases.updateOne(
        { _id: doc._id },
        { $pull: { notificationOutbox: { id: item.id } } },
      );
    }
}
async function scope(user: string) {
  const memberships = await (await getBusinessMemberships())
    .find({ privyUserId: user, role: { $in: ["owner", "admin"] } })
    .toArray();
  return {
    businessId: { $in: memberships.map((m) => m.businessId) },
    environment: verificationConfig().environment ?? "live",
  };
}
export async function listNotifications(
  user: string,
  cursor?: string,
  limit = 20,
) {
  const filter = await scope(user);
  const collection = await notices();
  let before = {};
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
      const at = new Date(parsed.at);
      if (typeof parsed.id !== "string" || !Number.isFinite(at.getTime()))
        throw new Error();
      before = { $or: [{ at: { $lt: at } }, { at, _id: { $lt: parsed.id } }] };
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid inbox cursor.",
      });
    }
  }
  const rows = await collection
    .find({ ...filter, ...before })
    .sort({ at: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();
  const page = rows.slice(0, limit);
  return {
    items: page.map((n) => ({
      id: n._id,
      businessId: n.businessId,
      kind: n.kind,
      message: messages[n.kind],
      createdAt: n.at.toISOString(),
      read: n.readBy.includes(user),
    })),
    nextCursor:
      rows.length > limit
        ? Buffer.from(
            JSON.stringify({
              at: page.at(-1)!.at.toISOString(),
              id: page.at(-1)!._id,
            }),
          ).toString("base64url")
        : null,
    unreadCount: await collection.countDocuments({
      ...filter,
      readBy: { $ne: user },
    }),
  };
}
export async function markRead(user: string, id?: string) {
  const filter = await scope(user);
  if (id) {
    const result = await (await notices()).updateOne(
      { ...filter, _id: id },
      { $addToSet: { readBy: user } },
    );
    if (!result.matchedCount) throw new TRPCError({ code: "NOT_FOUND" });
  } else
    await (await notices()).updateMany(filter, { $addToSet: { readBy: user } });
  return { ok: true };
}
