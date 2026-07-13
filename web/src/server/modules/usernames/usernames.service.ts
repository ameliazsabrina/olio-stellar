import "server-only";
import { Binary } from "mongodb";
import { bytesToHex } from "../../../lib/crypto";
import type { OlioAccount } from "../../../lib/stellar";
import {
  resolveUsernameOnChain,
  server,
  usernameOfOnChain,
} from "../../../lib/stellar";
import { getUsernames, type UsernameDoc } from "../../db/mongo";
import {
  RegistryLookupFailedError,
  UsernameNotOnChainError,
} from "./usernames.errors";
import type { ResolveOutput } from "./usernames.schema";

const USERNAME_CACHE_TTL_MS = 15 * 60 * 1000;

function isFresh(updatedAt: Date | undefined): boolean {
  return Boolean(
    updatedAt && Date.now() - updatedAt.getTime() < USERNAME_CACHE_TTL_MS,
  );
}

function toResolveOutput(doc: UsernameDoc): ResolveOutput {
  return {
    owner: doc.owner,
    notePubkeyHex: bytesToHex(doc.notePubkey.buffer),
    viewPubkeyHex: bytesToHex(doc.viewPubkey.buffer),
    createdAt: doc.createdAt.toISOString(),
  };
}

// Upsert the on-chain record into the Mongo mirror. Shared by the cache-miss
// path of `resolveUsername` and the explicit `registerUsernameCache` write, so
// Mongo only ever holds keys we just re-verified against the registry.
async function upsertFromChain(
  username: string,
  onChain: OlioAccount,
): Promise<ResolveOutput> {
  const usernames = await getUsernames();
  const latestLedger = (await server.getLatestLedger()).sequence;
  await usernames.updateOne(
    { _id: username },
    {
      $set: {
        owner: onChain.owner,
        notePubkey: new Binary(Buffer.from(onChain.note_pubkey)),
        viewPubkey: new Binary(Buffer.from(onChain.view_pubkey)),
        // Ledger this cache entry was (re)written at — not the ledger the
        // username actually registered at. The registry's `created` field
        // is a Unix timestamp with no event stream to recover the real
        // registration ledger sequence from.
        createdLedger: latestLedger,
        createdAt: new Date(Number(onChain.created) * 1000),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return {
    owner: onChain.owner,
    notePubkeyHex: bytesToHex(onChain.note_pubkey),
    viewPubkeyHex: bytesToHex(onChain.view_pubkey),
    createdAt: new Date(Number(onChain.created) * 1000).toISOString(),
  };
}

export async function resolveUsername(
  username: string,
): Promise<ResolveOutput> {
  const usernames = await getUsernames();
  const cached = await usernames.findOne({ _id: username });
  if (cached && isFresh(cached.updatedAt)) {
    return toResolveOutput(cached);
  }

  let onChain: OlioAccount | null;
  try {
    onChain = await resolveUsernameOnChain(username);
  } catch {
    if (cached) return toResolveOutput(cached);
    throw new RegistryLookupFailedError();
  }

  if (!onChain) {
    return null;
  }

  return upsertFromChain(username, onChain);
}

export async function registerUsernameCache(
  username: string,
): Promise<ResolveOutput> {
  const onChain = await resolveUsernameOnChain(username);
  if (!onChain) throw new UsernameNotOnChainError();
  return upsertFromChain(username, onChain);
}

export async function usernameByOwner(owner: string): Promise<string | null> {
  const usernames = await getUsernames();
  const cached = await usernames.findOne({ owner });
  if (cached) return cached._id;
  return usernameOfOnChain(owner);
}
