import "server-only";
import { Binary } from "mongodb";
import { getUsers } from "../../db/mongo";
import {
  relaySoroban as channelsRelaySoroban,
  relayXdr as channelsRelayXdr,
  type RelayResult,
} from "../channels/channels.service";
import type { WalletOutput } from "./passkey.schema";

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1)
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export async function deployWallet(xdr: string): Promise<RelayResult> {
  return channelsRelayXdr(xdr);
}

export async function relaySoroban(
  func: string,
  auth: string[],
): Promise<RelayResult> {
  return channelsRelaySoroban(func, auth);
}

export async function saveWallet(input: {
  contractId: string;
  credentialId: string;
  secp256r1PubKeyHex?: string;
}): Promise<void> {
  const users = await getUsers();
  const now = new Date();
  await users.updateOne(
    { _id: input.contractId },
    {
      $set: {
        address: input.contractId,
        contractId: input.contractId,
        credentialId: input.credentialId,
        updatedAt: now,
        ...(input.secp256r1PubKeyHex
          ? {
              secp256r1PubKey: new Binary(
                Buffer.from(hexToBytes(input.secp256r1PubKeyHex)),
              ),
            }
          : {}),
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

export async function walletByCredential(
  credentialId: string,
): Promise<WalletOutput> {
  const users = await getUsers();
  const doc = await users.findOne({ credentialId });
  if (!doc?.contractId) return null;
  return { contractId: doc.contractId, credentialId };
}
