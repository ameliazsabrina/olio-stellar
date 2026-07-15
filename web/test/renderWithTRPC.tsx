import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type RenderOptions,
  type RenderResult,
  render,
} from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import type { ReactElement, ReactNode } from "react";
import { trpc } from "../src/trpc/react";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

type Options = Omit<RenderOptions, "wrapper"> & { queryClient?: QueryClient };

export function renderWithTRPC(
  ui: ReactElement,
  { queryClient = createTestQueryClient(), ...options }: Options = {},
): RenderResult & { queryClient: QueryClient } {
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc" })],
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
