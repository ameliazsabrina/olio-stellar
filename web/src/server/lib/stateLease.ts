import "server-only";
import { getIndexerState, type IndexerStateDoc } from "../db/mongo";

type LeasedState = Exclude<IndexerStateDoc["_id"], "pool" | "registry">;

export async function acquireStateLease(
  id: LeasedState,
  owner: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();
  const states = await getIndexerState();
  try {
    const state = await states.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
          { leaseOwner: owner },
        ],
      },
      {
        $set: {
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + leaseMs),
        },
        $setOnInsert: { lastLedger: 0, lastLeafIndex: -1, updatedAt: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    return state?.leaseOwner === owner;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

export async function releaseStateLease(
  id: LeasedState,
  owner: string,
): Promise<void> {
  await (await getIndexerState()).updateOne(
    { _id: id, leaseOwner: owner },
    { $unset: { leaseOwner: "", leaseUntil: "" } },
  );
}
