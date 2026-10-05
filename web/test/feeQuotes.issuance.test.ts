// @vitest-environment node
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireAccountSubmission: mocks.submission,
}));
const mocks = vi.hoisted(() => ({
  submission: vi.fn(),
  routeReady: vi.fn(),
  resolve: vi.fn(),
  policy: vi.fn(),
  config: vi.fn(),
  secret: vi.fn(),
  user: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("../src/server/modules/cctp/cctp.readiness", () => ({
  routeReadiness: mocks.routeReady,
}));
vi.mock("../src/lib/stellar", async () => {
  const { StrKey } = await import("@stellar/stellar-sdk");
  return {
    networkPassphrase: "Test SDF Network ; September 2015",
    poolId: StrKey.encodeContract(Buffer.alloc(32, 9)),
    resolveUsernameOnChain: mocks.resolve,
    simulateRead: mocks.config,
  };
});
vi.mock("../src/lib/cctp", async () => {
  const { StrKey } = await import("@stellar/stellar-sdk");
  return {
    CCTP_STELLAR_DOMAIN: 27,
    SOLANA_SRC_DOMAIN: 5,
    EVM_SOURCES: { 0: {}, 6: {} },
    cctpIntakeContract: StrKey.encodeContract(Buffer.alloc(32, 8)),
  };
});
vi.mock("../src/env.server", () => ({ getServerEnv: mocks.secret }));
vi.mock("../src/server/db/mongo", () => ({
  getClientFeePolicies: async () => ({ findOne: mocks.policy }),
  getUsers: async () => ({ findOne: mocks.user }),
  getAsyncFeeQuoteContexts: async () => ({ insertOne: mocks.persist }),
}));

import { bytesToHex, commitment, R, toBE32 } from "../src/lib/crypto";
import {
  deserializeFeeQuoteEnvelope,
  verifyFeeQuoteSignature,
} from "../src/lib/fee-quote";
import type { IssueInput } from "../src/server/modules/feeQuotes/feeQuotes.schema";
import {
  issueFeeQuote,
  previewFeeQuote,
} from "../src/server/modules/feeQuotes/feeQuotes.service";

const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const owner = StrKey.encodeContract(Buffer.alloc(32, 6));
const intake = StrKey.encodeContract(Buffer.alloc(32, 8));
let input: IssueInput;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  mocks.resolve.mockResolvedValue({
    owner,
    note_pubkey: toBE32(11n),
    view_pubkey: toBE32(12n),
  });
  mocks.routeReady.mockResolvedValue({
    state: "enabled",
    reason: "ready",
    retryAfterMs: 15_000,
  });
  mocks.policy.mockResolvedValue(null);
  mocks.config.mockResolvedValue({ signer: signer.rawPublicKey() });
  mocks.secret.mockReturnValue({ FEE_QUOTE_SIGNING_SECRET: signer.secret() });
  mocks.user.mockResolvedValue({ _id: owner });
  mocks.persist.mockResolvedValue({ acknowledged: true });
  input = {
    username: "alice",
    paymentAmount: "1000000000",
    channel: "direct",
    depositor: owner,
    salt: bytesToHex(toBE32(13n)),
    commitment: bytesToHex(toBE32(await commitment(1_000_000_000n, 11n, 13n))),
  };
});
afterEach(() => vi.restoreAllMocks());

async function issue(request: IssueInput = input, user: string | null = null) {
  const envelope = deserializeFeeQuoteEnvelope(
    await issueFeeQuote(request, user),
  );
  expect(
    verifyFeeQuoteSignature(
      envelope.quote,
      envelope.signature,
      signer.rawPublicKey(),
    ),
  ).toBe(true);
  return envelope.quote;
}

describe("authoritative fee quote issuance", () => {
  it.each([
    200, 500,
  ] as const)("signs exact principal and gross at %i bps without persisting direct recipient context", async (feeBps) => {
    mocks.policy.mockResolvedValue({ feeBps });
    const quote = await issue();
    expect(quote).toMatchObject({
      paymentAmount: 1_000_000_000n,
      feeBps,
      feeAmount: feeBps === 200 ? 20_000_000n : 50_000_000n,
      totalAmount: feeBps === 200 ? 1_020_000_000n : 1_050_000_000n,
      issuedAt: 1_800_000_000n,
      expiresAt: 1_800_000_900n,
      sourceDomain: 0,
      sourcePayer: new Uint8Array(32),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect((await issue()).quoteId).not.toEqual(quote.quoteId);
  });

  it("re-reads policy between preview and issuance", async () => {
    expect((await previewFeeQuote(input)).feeBps).toBe(200);
    mocks.policy.mockResolvedValue({ feeBps: 500 });
    expect((await issue()).totalAmount).toBe(1_050_000_000n);
  });

  it("retains the owner tier after note-key rotation and rejects the old commitment", async () => {
    mocks.policy.mockResolvedValue({ feeBps: 500 });
    mocks.resolve.mockResolvedValue({
      owner,
      note_pubkey: toBE32(14n),
      view_pubkey: toBE32(12n),
    });
    await expect(issueFeeQuote(input, null)).rejects.toThrow(
      "Commitment does not match",
    );
    input.commitment = bytesToHex(
      toBE32(await commitment(1_000_000_000n, 14n, 13n)),
    );
    expect((await issue()).feeBps).toBe(500);
    expect(mocks.policy).toHaveBeenLastCalledWith(
      expect.objectContaining({ _id: owner }),
      { readPreference: "primary" },
    );
  });

  it.each([
    { paymentAmount: "999999999" },
    { salt: bytesToHex(toBE32(14n)) },
    { commitment: "00".repeat(32) },
    { salt: bytesToHex(toBE32(R)) },
  ])("rejects altered commitment inputs before accessing the signer: %j", async (change) => {
    await expect(
      issueFeeQuote({ ...input, ...change }, null),
    ).rejects.toThrow();
    expect(mocks.secret).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "outage",
  ])("fails closed on missing/unavailable recipient: %s", async (state) => {
    if (state) mocks.resolve.mockRejectedValue(new Error("registry down"));
    else mocks.resolve.mockResolvedValue(null);
    await expect(issueFeeQuote(input, null)).rejects.toThrow(
      state ? "unavailable" : "not found",
    );
    expect(mocks.secret).not.toHaveBeenCalled();
  });

  it("fails closed if policy storage fails after a successful preview", async () => {
    await previewFeeQuote(input);
    mocks.policy.mockRejectedValue(new Error("database credentials"));
    await expect(issueFeeQuote(input, null)).rejects.toThrow(
      "Fee policy storage is unavailable",
    );
    expect(mocks.secret).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "invalid-private-seed",
  ])("rejects missing/invalid signer configuration without leaking it", async (secret) => {
    mocks.secret.mockReturnValue({ FEE_QUOTE_SIGNING_SECRET: secret });
    await expect(issueFeeQuote(input, null)).rejects.toThrow(
      secret
        ? "Fee quote signer configuration is invalid."
        : "Fee quote signer is not configured.",
    );
  });

  it.each([
    "mismatch",
    "unavailable",
  ])("rejects signer parity %s", async (state) => {
    if (state === "mismatch")
      mocks.config.mockResolvedValue({ signer: Buffer.alloc(32) });
    else mocks.config.mockRejectedValue(new Error("RPC credentials"));
    await expect(issueFeeQuote(input, null)).rejects.toThrow(
      state === "mismatch" ? "does not match" : "Unable to verify",
    );
  });

  it.each([
    0, 5, 6,
  ])("binds CCTP source domain %i and durably stores only recovery context", async (sourceDomain) => {
    const quote = await issue({
      ...input,
      channel: "cctp",
      depositor: intake,
      sourceDomain,
      sourcePayer: "01".repeat(32),
    });
    expect(quote).toMatchObject({
      depositor: intake,
      sourceDomain,
      sourcePayer: new Uint8Array(32).fill(1),
      expiresAt: 1_800_086_400n,
    });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: bytesToHex(quote.quoteId),
        owner,
        commitment: input.commitment,
      }),
      { writeConcern: { w: "majority", j: true } },
    );
    expect(mocks.persist.mock.calls[0][0]).not.toHaveProperty("salt");
    expect(mocks.persist.mock.calls[0][0]).not.toHaveProperty("username");
  });

  it.each([
    { depositor: owner },
    { sourceDomain: 27 },
    { sourceDomain: 99 },
    { sourcePayer: "00".repeat(32) },
  ])("rejects invalid CCTP routing before signing: %j", async (change) => {
    await expect(
      issueFeeQuote(
        {
          ...input,
          channel: "cctp",
          depositor: intake,
          sourceDomain: 0,
          sourcePayer: "01".repeat(32),
          ...change,
        },
        null,
      ),
    ).rejects.toThrow();
    expect(mocks.secret).not.toHaveBeenCalled();
  });

  it("does not return a CCTP authorization when recovery context cannot be persisted", async () => {
    mocks.persist.mockRejectedValue(new Error("mongo down"));
    await expect(
      issueFeeQuote(
        {
          ...input,
          channel: "cctp",
          depositor: intake,
          sourceDomain: 0,
          sourcePayer: "01".repeat(32),
        },
        null,
      ),
    ).rejects.toThrow("Unable to persist CCTP recovery context");
  });
});

it("blocks only CCTP issuance when its route is unavailable", async () => {
  mocks.routeReady.mockResolvedValue({
    state: "temporarily_unavailable",
    reason: "worker_unavailable",
    retryAfterMs: 30_000,
  });
  await expect(
    issueFeeQuote(
      {
        ...input,
        channel: "cctp",
        depositor: intake,
        sourceDomain: 0,
        sourcePayer: "11".repeat(32),
      },
      null,
    ),
  ).rejects.toThrow("route is unavailable");
  expect(mocks.persist).not.toHaveBeenCalled();
  await expect(issueFeeQuote(input, null)).resolves.toBeDefined();
});

it("blocks new guest quotes for unsubmitted recipients", async () => {
  mocks.submission.mockRejectedValue(
    new Error("VERIFICATION_SUBMISSION_REQUIRED"),
  );
  await expect(issueFeeQuote(input, null)).rejects.toThrow(
    "VERIFICATION_SUBMISSION_REQUIRED",
  );
  expect(mocks.submission).toHaveBeenCalledWith(owner);
  expect(mocks.persist).not.toHaveBeenCalled();
});
