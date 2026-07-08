// Public (unauthenticated) tRPC client for read-only, off-chain-mirror
// endpoints (deposits, usernames). No bearer token — this is public
// chain-mirror data, not user secrets. See lib/privy.ts for the
// authenticated-call pattern this mirrors.

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/root";

export const api = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })]
});
