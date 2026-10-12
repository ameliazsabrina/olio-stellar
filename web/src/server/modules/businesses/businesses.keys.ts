import "server-only";
import { rpc } from "@stellar/stellar-sdk";
import { bytesToHex } from "../../../lib/crypto";
import { resolveUsernameOnChain, server } from "../../../lib/stellar";
import {
  type BusinessKeyDoc,
  getBusinessKeys,
  getBusinessProfiles,
} from "../../db/mongo";

const CONFIRM_ATTEMPTS = 30;
const CONFIRM_INTERVAL_MS = 1000;

export const businessKeyId = (businessId: string, generation: number) =>
  `${businessId}:${generation}`;

export async function businessKeyHistory(
  businessId: string,
): Promise<BusinessKeyDoc[]> {
  return (await getBusinessKeys())
    .find({ businessId })
    .sort({ generation: 1 })
    .toArray();
}

export async function syncBusinessKeys(
  businessId: string,
  source: BusinessKeyDoc["source"],
  ledger?: number,
): Promise<BusinessKeyDoc | null> {
  const keys = await getBusinessKeys();
  const business = await (await getBusinessProfiles()).findOne({
    _id: businessId,
  });
  if (!business?.username || !business.boundAccount) return null;
  const registered = await resolveUsernameOnChain(business.username);
  if (!registered || registered.owner !== business.boundAccount) return null;
  const notePubkey = bytesToHex(registered.note_pubkey);
  const viewPubkey = bytesToHex(registered.view_pubkey);
  const [latest] = await keys
    .find({ businessId })
    .sort({ generation: -1 })
    .limit(1)
    .toArray();
  if (
    latest &&
    latest.notePubkey === notePubkey &&
    latest.viewPubkey === viewPubkey
  ) {
    return latest;
  }
  const atLedger = latest
    ? (ledger ?? (await server.getLatestLedger()).sequence)
    : 0;
  const generation = (latest?.generation ?? 0) + 1;
  const doc: BusinessKeyDoc = {
    _id: businessKeyId(businessId, generation),
    businessId,
    generation,
    notePubkey,
    viewPubkey,
    activeFromLedger: atLedger,
    activeToLedger: null,
    source,
    recordedAt: new Date(),
  };
  try {
    await keys.insertOne(doc);
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return keys.findOne({ _id: doc._id });
  }
  if (latest) {
    await keys.updateOne(
      { _id: latest._id, activeToLedger: null },
      {
        $set: {
          activeToLedger: Math.max(latest.activeFromLedger, atLedger - 1),
        },
      },
    );
  }
  return doc;
}

export async function ensureBusinessKeys(businessId: string): Promise<void> {
  const existing = await (await getBusinessKeys()).countDocuments({
    businessId,
  });
  if (existing === 0) await syncBusinessKeys(businessId, "sync");
}

export async function recordKeysBeforeChange(account: string): Promise<void> {
  try {
    const business = await (await getBusinessProfiles()).findOne({
      boundAccount: account,
    });
    if (business) await ensureBusinessKeys(business._id);
  } catch (error) {
    console.warn(
      "[business-keys] current key generation was not recorded before rotation",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function confirmedLedger(txHash: string): Promise<number | null> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    const result = await server.getTransaction(txHash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS)
      return result.ledger;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) return null;
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
  }
  return null;
}

export async function confirmRegistryKeyChange(
  account: string,
  txHash: string,
): Promise<void> {
  try {
    const ledger = await confirmedLedger(txHash);
    if (ledger === null) return;
    const business = await (await getBusinessProfiles()).findOne({
      boundAccount: account,
    });
    if (business) await syncBusinessKeys(business._id, "relay", ledger);
  } catch (error) {
    console.warn(
      "[business-keys] registry key change was not recorded",
      error instanceof Error ? error.message : String(error),
    );
  }
}
