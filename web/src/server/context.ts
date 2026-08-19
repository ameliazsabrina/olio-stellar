import type { VerifyAccessTokenResponse } from "@privy-io/node";
import { verifyPrivyAccessToken } from "./lib/privy";

export type Context = {
  ip: string | null;
  authToken: string | null;
  privyUserId: string | null;
  privyClaim: VerifyAccessTokenResponse | null;
  authError: unknown | null;
};

function cookie(req: Request, name: string): string | null {
  const value = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
  return value ? decodeURIComponent(value) : null;
}

function accessToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim() || null;
  }
  return cookie(req, "privy-token");
}

export async function createTRPCContext(opts?: {
  req: Request;
}): Promise<Context> {
  if (!opts) {
    return {
      ip: null,
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
    };
  }

  const token = accessToken(opts.req);
  if (!token) {
    return {
      ip: clientIp(opts.req),
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
    };
  }

  try {
    const claim = await verifyPrivyAccessToken(token);
    return {
      ip: clientIp(opts.req),
      authToken: token,
      privyUserId: claim.user_id,
      privyClaim: claim,
      authError: null,
    };
  } catch (authError) {
    return {
      ip: clientIp(opts.req),
      authToken: token,
      privyUserId: null,
      privyClaim: null,
      authError,
    };
  }
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}
