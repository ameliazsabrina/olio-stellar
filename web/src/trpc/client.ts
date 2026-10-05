// tRPC client for the off-chain-mirror endpoints (deposits, usernames). Every
// procedure is public — this is public chain-mirror data, not user secrets.

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { verificationLink } from "./verificationLink";
import type { AppRouter } from "../server/root";

export const api = createTRPCProxyClient<AppRouter>({
  links: [
    verificationLink,
    httpBatchLink({
      url: "/api/trpc",
      headers: async () => {
        if (typeof window === "undefined") return {};
        const { getAccessToken } = await import("@privy-io/react-auth");
        const token = await getAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
