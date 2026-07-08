// Uses the app SECRET. Stellar is a Privy "tier-2" chain, so wallet creation
// and signing go through Privy's REST API; token verification uses the SDK.

import "server-only";
import { Buffer } from "buffer";
import { PrivyClient } from "@privy-io/server-auth";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
const APP_SECRET = process.env.PRIVY_APP_SECRET || "";

export const privyConfigured = Boolean(APP_ID && APP_SECRET);
export const privy = new PrivyClient(APP_ID, APP_SECRET);

const AUTH = "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

async function privyPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`https://api.privy.io${path}`, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      "privy-app-id": APP_ID,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Privy ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

/// Verify a Privy access token; returns the Privy user id or throws.
export async function verifyUser(token: string): Promise<string> {
  const claims = await privy.verifyAuthToken(token);
  return claims.userId;
}

/// Find the user's existing Stellar wallet, or create one owned by them.
export async function getOrCreateStellarWallet(
  userId: string
): Promise<{ address: string; walletId: string }> {
  const user = (await privy.getUser(userId)) as unknown as {
    linkedAccounts: Array<Record<string, unknown>>;
  };
  const existing = user.linkedAccounts?.find(
    (a) =>
      a.type === "wallet" &&
      (a.chainType === "stellar" || a.chain_type === "stellar")
  );
  if (existing) {
    return {
      address: String(existing.address),
      walletId: String(existing.id ?? existing.walletId)
    };
  }
  const created = await privyPost("/v1/wallets", {
    chain_type: "stellar",
    owner: { user_id: userId }
  });
  return { address: String(created.address), walletId: String(created.id) };
}

/// raw_sign a 32-byte hash (hex, no 0x) with a Privy Stellar wallet.
export async function rawSign(walletId: string, hashHex: string): Promise<string> {
  const r = await privyPost(`/v1/wallets/${walletId}/rpc`, {
    method: "raw_sign",
    params: { hash: "0x" + hashHex }
  });
  const sig: string = r?.data?.signature ?? r?.signature;
  if (!sig) throw new Error("Privy raw_sign returned no signature");
  return sig.startsWith("0x") ? sig.slice(2) : sig;
}
