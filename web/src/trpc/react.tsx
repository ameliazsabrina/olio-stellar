"use client";

import { getAccessToken } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type ReactNode, useState } from "react";
import type { AppRouter } from "../server/root";

export const trpc = createTRPCReact<AppRouter>();

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          headers: async () => {
            const token = await getAccessToken();
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
