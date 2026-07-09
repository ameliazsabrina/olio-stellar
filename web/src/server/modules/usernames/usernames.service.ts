// Mongo-backed cache of the username registry. Cache misses always
// re-verify against the registry contract before ever serving/caching a
// result, so Mongo can never redirect a payment to keys that weren't
// actually registered on-chain.
//
// `resolve` uses a TTL, not a plain cache-aside, because the registry's
// `set_pubkey` lets an owner rotate their note key at any time and the
// registry contract emits zero events — there is no invalidation signal to
// hook, so staleness has to be bounded by time instead.

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

  let onChain;
  try {
    onChain = await resolveUsernameOnChain(username);
  } catch {
    // Transient RPC failure, not "not found" — fail open to a stale cache
    // entry if we have one rather than falsely reporting "not registered."
    if (cached) return toResolveOutput(cached);
    throw new RegistryLookupFailedError();
  }

  if (!onChain) {
    // Genuinely not registered. Don't cache the miss — there's no
    // invalidation mechanism, so a negative cache entry would permanently
    // shadow someone who registers moments later.
    return null;
  }

  return upsertFromChain(username, onChain);
}

// Explicit write triggered right after an on-chain `register` tx. Re-reads the
// registry to confirm the username really is registered (and to the keys the
// contract stored), then mirrors it into Mongo. Throws if the record isn't
// on-chain yet so the caller knows the register tx hasn't confirmed.
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
  // No TTL here: returns only a display string (no key material), and
  // owner->username is immutable on-chain (registry has no
  // unregister/reassign method).
  if (cached) return cached._id;

  // A bare username_of call doesn't return note_pubkey/view_pubkey/created,
  // so there isn't enough data to satisfy the collection's required-field
  // validator — don't attempt a partial upsert. The full doc gets
  // populated naturally the next time anyone calls `resolve` on it.
  return usernameOfOnChain(owner);
}
