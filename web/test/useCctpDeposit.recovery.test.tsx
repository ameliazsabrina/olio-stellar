// @vitest-environment happy-dom

import { StrKey } from "@stellar/stellar-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cctpFixture } from "./helpers/cctpFixture";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  issue: vi.fn(),
  createSession: vi.fn(),
  recordSubmission: vi.fn(),
  sessionStatus: vi.fn(),
  resumeSession: vi.fn(),
  prepareBurn: vi.fn(),
  burn: vi.fn(),
  burnSolana: vi.fn(),
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    feeQuotes: { issue: { mutate: mocks.issue } },
    cctp: {
      createSession: { mutate: mocks.createSession },
      recordSubmission: { mutate: mocks.recordSubmission },
      sessionStatus: { mutate: mocks.sessionStatus },
      resumeSession: { mutate: mocks.resumeSession },
      prepareBurn: { mutate: mocks.prepareBurn },
    },
  },
}));
vi.mock("../src/features/cctpPayer/burn", () => ({
  burnToStellar: mocks.burn,
  evmCctpIdentity: mocks.identity,
}));
vi.mock("../src/features/cctpPayer/burnSolana", () => ({
  burnFromSolana: mocks.burnSolana,
}));
vi.mock("../src/lib/cctp", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/cctp")>();
  const { StrKey } = await import("@stellar/stellar-sdk");
  return {
    ...original,
    cctpIntakeContract: StrKey.encodeContract(Buffer.alloc(32, 8)),
  };
});

import { useCctpDeposit } from "../src/features/cctpPayer/hooks/useCctpDeposit";
import {
  type RecoveryRecord,
  recoveryKey,
} from "../src/features/cctpPayer/recovery";

let fixture: Awaited<ReturnType<typeof cctpFixture>>;
const capability = "ab".repeat(32);
const sessionId = "cd".repeat(32);
const expectedFee = {
  paymentAmount: "1000000000",
  feeBps: 200 as const,
  feeAmount: "20000000",
  totalAmount: "1020000000",
  policyVersion: 2 as const,
};
const statusFixture = (stage: string) => ({
  sessionId,
  sourceDomain: 0,
  stage,
  paymentAmount: expectedFee.paymentAmount,
  feeAmount: expectedFee.feeAmount,
  totalAmount: expectedFee.totalAmount,
  sourceTxHash: null,
  destinationTxHash: null,
  errorCode: null,
  retryAfterMs: 0,
  updatedAt: new Date().toISOString(),
  result: null,
});
const sessionKeys = () => {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("olio:cctp-session:")) keys.push(key);
  }
  return keys;
};

beforeAll(async () => {
  fixture = await cctpFixture();
});
beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    sourceDomain: 0,
    sourcePayer: "17".repeat(32),
  });
  mocks.issue.mockResolvedValue(fixture.envelope);
  mocks.createSession.mockResolvedValue(statusFixture("awaiting_signature"));
  mocks.prepareBurn.mockResolvedValue(statusFixture("awaiting_signature"));
  mocks.recordSubmission.mockResolvedValue(statusFixture("source_submitted"));
  mocks.sessionStatus.mockResolvedValue(statusFixture("source_submitted"));
  mocks.resumeSession.mockResolvedValue(statusFixture("source_submitted"));
});

describe("useCctpDeposit durable recovery", () => {
  it("persists recovery keyed by network/pool/quote before the burn is requested", async () => {
    let keysAtBurn: string[] = [];
    mocks.burn.mockImplementation(async ({ beforeBurn, onSubmitted }) => {
      await beforeBurn?.();
      keysAtBurn = sessionKeys();
      await onSubmitted?.(`0x${"cd".repeat(32)}`);
    });

    const { result } = renderHook(() =>
      useCctpDeposit({ username: "alice", notePubkey: new Uint8Array(32) }),
    );
    await act(async () => {
      await result.current.start("1000", expectedFee, { chain: "evm" });
    });

    expect(mocks.identity).toHaveBeenCalledWith(undefined);
    expect(keysAtBurn).toHaveLength(1);
    expect(keysAtBurn[0]).toContain(
      fixture.quote.quoteId.reduce(
        (s, b) => s + b.toString(16).padStart(2, "0"),
        "",
      ),
    );
    expect(keysAtBurn[0]).not.toContain("alice");
    expect(mocks.burn).toHaveBeenCalledTimes(1);
    expect(mocks.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        sourceTxHash: `0x${"cd".repeat(32)}`,
      }),
    );
  });

  it("migrates a legacy username-only pending record into a session recovery", async () => {
    const legacyTx = `0x${"ef".repeat(32)}`;
    window.localStorage.setItem(
      "olio:cctp-relay:alice",
      JSON.stringify({
        salt: fixture.salt,
        feeQuote: fixture.envelope,
        txHash: legacyTx,
      }),
    );

    renderHook(() =>
      useCctpDeposit({ username: "alice", notePubkey: new Uint8Array(32) }),
    );

    await waitFor(() => expect(sessionKeys()).toHaveLength(1));
    const stored: RecoveryRecord = JSON.parse(
      window.localStorage.getItem(sessionKeys()[0]!)!,
    );
    expect(stored.input.legacySourceTxHash).toBe(legacyTx);
    expect(stored.sourceTxHash).toBe(legacyTx);
    expect(stored.input.username).toBe("alice");
  });

  it("restores a valid recovery file and rejects one for a different deployment", async () => {
    const valid: RecoveryRecord = {
      version: 1,
      input: {
        username: "alice",
        salt: fixture.salt,
        feeQuote: fixture.envelope,
        capability,
      },
      sessionId,
    };
    const { result } = renderHook(() =>
      useCctpDeposit({ username: "alice", notePubkey: new Uint8Array(32) }),
    );

    await act(async () => {
      await result.current.restore(JSON.stringify([valid]));
    });
    expect(window.localStorage.getItem(recoveryKey(valid))).not.toBeNull();
    expect(mocks.sessionStatus).toHaveBeenCalledWith({ sessionId, capability });

    const foreign = {
      ...valid,
      input: {
        ...valid.input,
        feeQuote: {
          ...fixture.envelope,
          quote: {
            ...fixture.envelope.quote,
            depositor: StrKey.encodeContract(Buffer.alloc(32, 5)),
          },
        },
      },
    };
    await expect(
      result.current.restore(JSON.stringify([foreign])),
    ).rejects.toThrow(/different recipient or deployment/);
  });

  it("discards an unburned intent when the route is unavailable and never blocks the next attempt", async () => {
    mocks.createSession.mockRejectedValueOnce(
      new Error("temporarily unavailable"),
    );
    mocks.burn.mockImplementation(async ({ onSubmitted }) => {
      await onSubmitted?.(`0x${"cd".repeat(32)}`);
    });

    const { result } = renderHook(() =>
      useCctpDeposit({ username: "alice", notePubkey: new Uint8Array(32) }),
    );
    await act(async () => {
      await result.current.start("1000", expectedFee, { chain: "evm" });
    });
    expect(mocks.burn).not.toHaveBeenCalled();
    expect(sessionKeys()).toHaveLength(0);
    expect(result.current.hasPendingPayment).toBe(false);

    await act(async () => {
      await result.current.start("1000", expectedFee, { chain: "evm" });
    });
    expect(mocks.burn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.hasPendingPayment).toBe(true));
  });

  it("auto-resumes a submitted payment without any user action", async () => {
    const record: RecoveryRecord = {
      version: 1,
      input: {
        username: "alice",
        salt: fixture.salt,
        feeQuote: fixture.envelope,
        capability,
      },
      sessionId,
      sourceTxHash: `0x${"cd".repeat(32)}`,
    };
    window.localStorage.setItem(recoveryKey(record), JSON.stringify(record));

    renderHook(() =>
      useCctpDeposit({ username: "alice", notePubkey: new Uint8Array(32) }),
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(mocks.resumeSession).toHaveBeenCalledWith({
        sessionId,
        capability,
      }),
    );
    expect(mocks.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        sourceTxHash: `0x${"cd".repeat(32)}`,
      }),
    );
  });
  it("requests a pinned Base identity before issuing the fee quote", async () => {
    mocks.identity.mockResolvedValue({
      sourceDomain: 6,
      sourcePayer: "17".repeat(32),
    });
    mocks.burn.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCctpDeposit({ username: "alice", notePubkey: new Uint8Array(32) }),
    );
    await act(async () => {
      await result.current.start("1000", expectedFee, { chain: "base" });
    });
    expect(mocks.identity).toHaveBeenCalledWith(6);
    expect(mocks.issue).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDomain: 6 }),
    );
  });
});
