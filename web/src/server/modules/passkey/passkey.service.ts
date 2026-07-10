import "server-only";
import { Binary } from "mongodb";
import { getUsers } from "../../db/mongo";
import {
  type RelayResult,
  relaySoroban as channelsRelaySoroban,
  relayXdr as channelsRelayXdr,
} from "../channels/channels.service";
import type { WalletOutput } from "./passkey.schema";

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1)
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

// Sponsor the smart-wallet deploy (a signed CreateContract envelope).
export async function deployWallet(xdr: string): Promise<RelayResult> {
  return channelsRelayXdr(xdr);
}

// Sponsor a passkey-authorized invocation (func + passkey-signed auth entries).
// Public: the smart wallet's on-chain __check_auth is what actually guards funds;
// only relayer fee budget is at stake. TODO(WS4): gate behind a passkey session.
export async function relaySoroban(
  func: string,
  auth: string[],
): Promise<RelayResult> {
  return channelsRelaySoroban(func, auth);
}

// Mirror a freshly-deployed smart wallet. Keyed by the contract id (the passkey
// account's on-chain address), so it slots into the same `users` collection.
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
