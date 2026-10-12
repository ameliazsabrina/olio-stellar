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
  config: vi.fn(),
  secret: vi.fn(),
  user: vi.fn(),
  persist: vi.fn(),
  bindInvoice: vi.fn(),
  attribution: vi.fn(),
}));
vi.mock("../src/server/modules/feeQuotes/feeQuotes.attribution", () => ({
  bindInvoiceIntent: mocks.bindInvoice,
  recordQuoteAttribution: mocks.attribution,
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
  mocks.config.mockResolvedValue({ signer: signer.rawPublicKey() });
  mocks.secret.mockReturnValue({ FEE_QUOTE_SIGNING_SECRET: signer.secret() });
  mocks.user.mockResolvedValue({ _id: owner });
  mocks.persist.mockResolvedValue({ acknowledged: true });
  mocks.attribution.mockResolvedValue(undefined);
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
  it("signs exact principal and gross at 2% without persisting direct recipient context", async () => {
    const quote = await issue();
    expect(quote).toMatchObject({
      paymentAmount: 1_000_000_000n,
      feeBps: 200,
      feeAmount: 20_000_000n,
      totalAmount: 1_020_000_000n,
      issuedAt: 1_800_000_000n,
      expiresAt: 1_800_000_900n,
      sourceDomain: 0,
      sourcePayer: new Uint8Array(32),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect((await issue()).quoteId).not.toEqual(quote.quoteId);
  });

  it("rejects the old commitment after note-key rotation", async () => {
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
    expect((await issue()).feeBps).toBe(200);
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

describe("invoice-bound issuance", () => {
  it("derives the quote id from the invoice intent and records attribution", async () => {
    const quoteId = new Uint8Array(32).fill(3);
    const binding = {
      invoice: { _id: "inv_12345678", businessId: "biz_12345678" },
      version: { version: 2, invoiceCommitment: "11".repeat(32) },
      intentNonce: new Uint8Array(32).fill(4),
      quoteId,
    };
    mocks.bindInvoice.mockResolvedValue(binding);
    const quote = await issue({
      ...input,
      invoice: { invoiceId: "inv_12345678", version: 2 },
    });
    expect(mocks.bindInvoice).toHaveBeenCalledWith(
      { invoiceId: "inv_12345678", version: 2 },
      owner,
    );
    expect(quote.quoteId).toEqual(quoteId);
    expect(mocks.attribution).toHaveBeenCalledWith(
      expect.objectContaining({ binding, sourceDomain: 0 }),
    );
  });

  it("records attribution for direct quotes without an invoice", async () => {
    await issue();
    expect(mocks.bindInvoice).not.toHaveBeenCalled();
    expect(mocks.attribution).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: null,
        recipient: expect.objectContaining({ owner }),
      }),
    );
  });

  it("does not sign a quote when the invoice cannot be paid", async () => {
    mocks.bindInvoice.mockRejectedValue(new Error("not payable"));
    await expect(
      issueFeeQuote(
        { ...input, invoice: { invoiceId: "inv_12345678", version: 1 } },
        null,
      ),
    ).rejects.toThrow("not payable");
    expect(mocks.attribution).not.toHaveBeenCalled();
  });

  it("refuses to sign when attribution cannot be stored", async () => {
    mocks.attribution.mockRejectedValue(new Error("storage down"));
    await expect(issueFeeQuote(input, null)).rejects.toThrow("storage down");
  });
});
