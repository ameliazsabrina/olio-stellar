vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireAccountSubmission: vi.fn(),
}));
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveUsernameOnChain: vi.fn(),
}));

vi.mock("../src/lib/stellar", () => ({
  networkPassphrase: "Test SDF Network ; September 2015",
  poolId: "",
  resolveUsernameOnChain: mocks.resolveUsernameOnChain,
  simulateRead: vi.fn(),
}));
vi.mock("../src/server/db/mongo", () => ({
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

describe("fee quote preview", () => {
  it("always quotes the flat 2% Olio fee", async () => {
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

  it("fails closed when the recipient registry is unavailable", async () => {
    mocks.resolveUsernameOnChain.mockRejectedValue(new Error("rpc down"));
    await expect(
      previewFeeQuote({
        username: "alice",
        paymentAmount: "1000000000",
        channel: "direct",
      }),
    ).rejects.toBeInstanceOf(FeePolicyUnavailableError);
  });
});
