vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireAccountSubmission: vi.fn(),
}));
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveUsernameOnChain: vi.fn(),
  findPolicy: vi.fn(),
}));

vi.mock("../src/lib/stellar", () => ({
  networkPassphrase: "Test SDF Network ; September 2015",
  poolId: "",
  resolveUsernameOnChain: mocks.resolveUsernameOnChain,
  simulateRead: vi.fn(),
}));
vi.mock("../src/server/db/mongo", () => ({
  getClientFeePolicies: async () => ({ findOne: mocks.findPolicy }),
  getUsers: vi.fn(),
}));

import { FeePolicyUnavailableError } from "../src/server/modules/feeQuotes/feeQuotes.errors";
import { previewFeeQuote } from "../src/server/modules/feeQuotes/feeQuotes.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveUsernameOnChain.mockResolvedValue({
    owner: "COWNER",
    note_pubkey: new Uint8Array(32).fill(1),
    view_pubkey: new Uint8Array(32).fill(2),
    created: 1n,
  });
});

describe("fee quote policy lookup", () => {
  it("returns the default 2% when no active owner override exists", async () => {
    mocks.findPolicy.mockResolvedValue(null);
    await expect(
      previewFeeQuote({
        username: "alice",
        paymentAmount: "1000000000",
        channel: "direct",
      }),
    ).resolves.toEqual({
      paymentAmount: "1000000000",
      feeBps: 200,
      feeAmount: "20000000",
      totalAmount: "1020000000",
      policyVersion: 2,
    });
  });

  it("returns 5% for the active policy keyed by stable registry owner", async () => {
    mocks.findPolicy.mockResolvedValue({
      _id: "COWNER",
      feeBps: 500,
      state: "active",
    });
    const result = await previewFeeQuote({
      username: "alice",
      paymentAmount: "1000000000",
      channel: "direct",
    });
    expect(result).toMatchObject({
      feeBps: 500,
      feeAmount: "50000000",
      totalAmount: "1050000000",
    });
    expect(mocks.findPolicy.mock.calls[0][0]).toMatchObject({
      _id: "COWNER",
      state: "active",
    });
    expect(mocks.findPolicy.mock.calls[0][1]).toEqual({
      readPreference: "primary",
    });
  });

  it("fails closed when policy storage is unavailable", async () => {
    mocks.findPolicy.mockRejectedValue(new Error("mongo down"));
    await expect(
      previewFeeQuote({
        username: "alice",
        paymentAmount: "1000000000",
        channel: "direct",
      }),
    ).rejects.toBeInstanceOf(FeePolicyUnavailableError);
  });

  it("fails closed when a policy record contains an unsupported rate", async () => {
    mocks.findPolicy.mockResolvedValue({
      _id: "COWNER",
      feeBps: 0,
      state: "active",
    });
    await expect(
      previewFeeQuote({
        username: "alice",
        paymentAmount: "1000000000",
        channel: "direct",
      }),
    ).rejects.toBeInstanceOf(FeePolicyUnavailableError);
  });
});
