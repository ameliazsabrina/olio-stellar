// tRPC client for the off-chain-mirror endpoints (deposits, usernames). Every
// procedure is public — this is public chain-mirror data, not user secrets.

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/root";

export const api = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
