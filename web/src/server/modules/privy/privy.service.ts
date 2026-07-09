import "server-only";
import { PrivyClient } from "@privy-io/server-auth";
import { Buffer } from "buffer";
import { getUsers } from "../../db/mongo";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
const APP_SECRET = process.env.PRIVY_APP_SECRET || "";

export const privyConfigured = Boolean(APP_ID && APP_SECRET);
export const privy = new PrivyClient(APP_ID, APP_SECRET);

const AUTH =
  "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

async function privyPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`https://api.privy.io${path}`, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      "privy-app-id": APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Privy ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function verifyUser(token: string): Promise<string> {
  const claims = await privy.verifyAuthToken(token);
  return claims.userId;
}

export async function getOrCreateStellarWallet(
  userId: string,
): Promise<{ address: string; walletId: string }> {
  const users = await getUsers();

  const cached = await users.findOne({ _id: userId });
  if (cached) {
    return { address: cached.address, walletId: cached.walletId };
  }

  const user = (await privy.getUser(userId)) as unknown as {
    linkedAccounts: Array<Record<string, unknown>>;
  };
  const existing = user.linkedAccounts?.find(
    (a) =>
      a.type === "wallet" &&
      (a.chainType === "stellar" || a.chain_type === "stellar"),
  );
  const wallet = existing
    ? {
        address: String(existing.address),
        walletId: String(existing.id ?? existing.walletId),
      }
    : await (async () => {
        const created = await privyPost("/v1/wallets", {
          chain_type: "stellar",
          owner: { user_id: userId },
        });
        return {
          address: String(created.address),
          walletId: String(created.id),
        };
      })();

  const now = new Date();
  await users.updateOne(
    { _id: userId },
    {
      $set: {
        address: wallet.address,
        walletId: wallet.walletId,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return wallet;
}

/// raw_sign a 32-byte hash (hex, no 0x) with a Privy Stellar wallet.
export async function rawSign(
  walletId: string,
  hashHex: string,
): Promise<string> {
  const r = await privyPost(`/v1/wallets/${walletId}/rpc`, {
    method: "raw_sign",
    params: { hash: "0x" + hashHex },
  });
  const sig: string = r?.data?.signature ?? r?.signature;
  if (!sig) throw new Error("Privy raw_sign returned no signature");
  return sig.startsWith("0x") ? sig.slice(2) : sig;
}
