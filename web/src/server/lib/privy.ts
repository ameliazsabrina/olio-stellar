import "server-only";

import { PrivyClient, type VerifyAccessTokenResponse } from "@privy-io/node";
import { getServerEnv } from "../../env.server";

let client: PrivyClient | null = null;

function config(): { appId: string; appSecret: string } | null {
  const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: appSecret } = getServerEnv();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function privyConfigured(): boolean {
  return config() !== null;
}

function getPrivyClient(): PrivyClient {
  const configured = config();
  if (!configured)
    throw new Error("Privy server credentials are not configured.");
  client ??= new PrivyClient(configured);
  return client;
}

export async function verifyPrivyAccessToken(
  token: string,
): Promise<VerifyAccessTokenResponse> {
  const claim = await getPrivyClient().utils().auth().verifyAccessToken(token);
  const configured = config();
  if (!configured || claim.app_id !== configured.appId) {
    throw new Error("Privy access token was issued for a different app.");
  }
  return claim;
}

export async function getPrivyUser(userId: string) {
  const user = await getPrivyClient().users()._get(userId);
  if (user.id !== userId) {
    throw new Error("Privy returned a different user identity.");
  }
  return user;
}

export async function getPrivyUserByWalletAddress(address: string) {
  try {
    return await getPrivyClient().users().getByWalletAddress({ address });
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}
