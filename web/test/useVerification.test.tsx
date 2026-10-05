// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_POLL_WINDOW_MS,
  shouldPoll,
  useVerification,
} from "../src/features/verification/useVerification";
import { trpc } from "../src/trpc/react";
import { createTestQueryClient } from "./renderWithTRPC";

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ address: "account-a" }),
}));

type Status = Parameters<typeof shouldPoll>[0];

function status(overrides: Partial<NonNullable<Status>> = {}): Status {
  return {
    businessId: "biz_1",
    type: "individual",
    environment: "sandbox",
    mode: "sandbox",
    eligibility: "pending",
    providerStage: "submitted",
    userMessage: null,
    nextAction: "wait",
    checkedAt: null,
    lastEventAt: null,
    policyVersion: 1,
    credential: null,
    canStart: false,
    ...overrides,
  } as NonNullable<Status>;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify([{ result: { data: [] } }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

function renderVerificationHook() {
  const queryClient = createTestQueryClient();
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc" })],
  });
  return renderHook(() => useVerification(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    ),
  });
}

describe("active polling window", () => {
  const now = 1_700_000_000_000;

  it("polls only after a submission and only while the case is open", () => {
    expect(shouldPoll(status(), now - 1000, now)).toBe(true);
    expect(shouldPoll(status(), null, now)).toBe(false);
    expect(shouldPoll(undefined, now, now)).toBe(false);
  });

  it("stops polling once the case reaches a decided state", () => {
    for (const eligibility of ["approved", "declined"] as const) {
      expect(
        shouldPoll(
          status({ eligibility, providerStage: "completed" }),
          now - 1000,
          now,
        ),
      ).toBe(false);
    }
  });

  it("stops polling after the active window elapses", () => {
    expect(shouldPoll(status(), now - ACTIVE_POLL_WINDOW_MS - 1, now)).toBe(
      false,
    );
  });
});

describe("callback stability", () => {
  it("keeps the session callbacks stable across re-renders", () => {
    const hook = renderVerificationHook();
    const first = {
      requestToken: hook.result.current.requestToken,
      requestRefresh: hook.result.current.requestRefresh,
      markSubmitted: hook.result.current.markSubmitted,
    };

    hook.rerender();
    hook.rerender();

    expect(hook.result.current.requestToken).toBe(first.requestToken);
    expect(hook.result.current.requestRefresh).toBe(first.requestRefresh);
    expect(hook.result.current.markSubmitted).toBe(first.markSubmitted);
    hook.unmount();
  });
});
