// @vitest-environment node
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeePolicyUnavailableError,
  FeeQuoteReadinessError,
  FeeQuoteRouteUnavailableError,
} from "../src/server/modules/feeQuotes/feeQuotes.errors";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  issue: vi.fn(),
  assertReady: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock("../src/server/modules/feeQuotes/feeQuotes.service", () => ({
  previewFeeQuote: mocks.preview,
  issueFeeQuote: mocks.issue,
}));
vi.mock("../src/server/modules/feeQuotes/feeQuotes.readiness", () => ({
  assertPaymentIngressReady: mocks.assertReady,
  getCachedFeeQuoteReadiness: mocks.readiness,
}));

import {
  feeQuotesRouter,
  resetFeeQuoteRateLimitsForTests,
} from "../src/server/modules/feeQuotes/feeQuotes.router";

const caller = () =>
  feeQuotesRouter.createCaller({
    ip: "203.0.113.1",
    authToken: null,
    privyUserId: null,
    privyClaim: null,
    authError: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertReady.mockResolvedValue(undefined);
  mocks.readiness.mockResolvedValue({
    checkedAt: new Date(0).toISOString(),
    network: "testnet",
    ready: true,
    channels: {
      direct: { ready: true },
      cctp: { ready: true },
    },
    diagnostics: [],
  });
  resetFeeQuoteRateLimitsForTests();
});

afterEach(() => resetFeeQuoteRateLimitsForTests());

describe("feeQuotes API", () => {
  it("rejects extra fields before calling the preview service", async () => {
    await expect(
      caller().preview({
        username: "alice",
        paymentAmount: "1",
        channel: "direct",
        feeBps: 200,
      } as never),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("maps policy outages without silently returning the default tier", async () => {
    mocks.preview.mockRejectedValue(
      new FeePolicyUnavailableError("unavailable"),
    );
    await expect(
      caller().preview({
        username: "alice",
        paymentAmount: "1",
        channel: "direct",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("blocks checkout before preview when deployment readiness fails", async () => {
    mocks.assertReady.mockRejectedValue(
      new FeeQuoteReadinessError(["SIGNER_MISSING", "POOL_ABI_INCOMPATIBLE"]),
    );
    await expect(
      caller().preview({
        username: "alice",
        paymentAmount: "1",
        channel: "direct",
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Payment quoting is unavailable.",
    });
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("reports a closed cross-chain route as a precondition, not a fault", async () => {
    mocks.issue.mockRejectedValue(
      new FeeQuoteRouteUnavailableError("eligibility_not_confirmed", 30_000),
    );
    await expect(
      caller().issue({
        username: "alice",
        paymentAmount: "1",
        channel: "cctp",
        depositor:
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM",
        commitment: "00".repeat(32),
        salt: "01".repeat(32),
        sourceDomain: 0,
        sourcePayer: "11".repeat(32),
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "This cross-chain route is unavailable. No payment has been initiated.",
    });
  });

  it("rate-limits issue more aggressively than preview and isolates IPs", async () => {
    mocks.issue.mockResolvedValue({
      quote: {
        formatVersion: 1,
        policyVersion: 2,
        quoteId: "01".repeat(32),
        networkId: "02".repeat(32),
        pool: "CPOOL",
        depositor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        commitment: "00".repeat(32),
        paymentAmount: "1",
        feeBps: 200,
        feeAmount: "0",
        totalAmount: "1",
        channel: "direct",
        sourceDomain: 0,
        sourcePayer: "00".repeat(32),
        issuedAt: "1",
        expiresAt: "901",
      },
      signature: "03".repeat(64),
    });
    const input = {
      username: "alice",
      paymentAmount: "1",
      channel: "direct" as const,
      depositor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      commitment: "00".repeat(32),
      salt: "01".repeat(32),
    };
    for (let index = 0; index < 15; index += 1) {
      await expect(caller().issue(input)).resolves.toMatchObject({
        quote: { totalAmount: "1" },
      });
    }
    await expect(caller().issue(input)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    const other = feeQuotesRouter.createCaller({
      ip: "203.0.113.2",
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
    });
    await expect(other.issue(input)).resolves.toMatchObject({
      quote: { totalAmount: "1" },
    });
    expect(mocks.issue).toHaveBeenCalledTimes(16);
  });

});
