import "server-only";
import {
  bytesToHex,
  fromBE,
  poseidonHash,
  TREE_DEPTH,
  toBE32,
  zeros,
} from "../../../lib/crypto";
import { poolId, simulateRead } from "../../../lib/stellar";
import { getDeposits, getPoolRoots } from "../../db/mongo";
import { DepositIndexGapError } from "./deposits.errors";

export type RootFrontier = {
  leafCount: number;
  frontier: bigint[];
  root: bigint;
};

export type RootCheck = "match" | "mismatch" | "unverified";

const toHex = (value: bigint) => bytesToHex(toBE32(value));
const fromHex = (value: string) => BigInt(`0x${value}`);

export async function insertLeaf(
  frontier: bigint[],
  index: number,
  leaf: bigint,
  zeroes: bigint[],
  depth: number,
): Promise<{ root: bigint; frontier: bigint[] }> {
  const next = Array.from(
    { length: depth },
    (_, i) => frontier[i] ?? zeroes[i],
  );
  let current = leaf;
  let position = index;
  for (let level = 0; level < depth; level += 1) {
    if ((position & 1) === 0) {
      next[level] = current;
      current = await poseidonHash([current, zeroes[level]]);
    } else {
      current = await poseidonHash([next[level], current]);
    }
    position >>= 1;
  }
  return { root: current, frontier: next };
}

export async function advancePoolRoots(
  state: { rootLeafCount?: number; rootFrontier?: string[] } | null,
  leafCount: number,
  depth = TREE_DEPTH,
): Promise<RootFrontier> {
  const zeroes = await zeros(depth);
  const resume =
    typeof state?.rootLeafCount === "number" &&
    state.rootLeafCount <= leafCount &&
    (state.rootLeafCount === 0 || state.rootFrontier?.length === depth);
  let count = resume ? (state?.rootLeafCount ?? 0) : 0;
  let frontier = resume ? (state?.rootFrontier ?? []).map(fromHex) : [];
  let root = zeroes[depth];
  if (count > 0) {
    const stored = await (await getPoolRoots()).findOne({ _id: count });
    if (!stored) {
      count = 0;
      frontier = [];
    } else {
      root = fromHex(stored.root);
    }
  }
  if (count === leafCount) return { leafCount: count, frontier, root };

  const deposits = await (await getDeposits())
    .find({ _id: { $gte: count, $lt: leafCount } })
    .sort({ _id: 1 })
    .toArray();
  const ops = [];
  for (const deposit of deposits) {
    if (deposit._id !== count) throw new DepositIndexGapError(leafCount, count);
    const inserted = await insertLeaf(
      frontier,
      count,
      fromBE(deposit.commitment.buffer),
      zeroes,
      depth,
    );
    frontier = inserted.frontier;
    root = inserted.root;
    count += 1;
    ops.push({
      updateOne: {
        filter: { _id: count },
        update: {
          $set: { root: toHex(root), ledger: deposit.ledger, ts: deposit.ts },
        },
        upsert: true,
      },
    });
  }
  if (count !== leafCount) throw new DepositIndexGapError(leafCount, count);
  if (ops.length)
    await (await getPoolRoots()).bulkWrite(ops, { ordered: true });
  return { leafCount: count, frontier, root };
}

export function serializeFrontier(frontier: bigint[]): string[] {
  return frontier.map(toHex);
}

export async function checkRootAtTip(
  roots: RootFrontier,
  readLeafCount: () => Promise<number>,
): Promise<RootCheck> {
  try {
    if ((await readLeafCount()) !== roots.leafCount) return "unverified";
    const raw = await simulateRead(poolId, "current_root");
    const onChain =
      raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
    if ((await readLeafCount()) !== roots.leafCount) return "unverified";
    return bytesToHex(onChain) === toHex(roots.root) ? "match" : "mismatch";
  } catch {
    return "unverified";
  }
}
