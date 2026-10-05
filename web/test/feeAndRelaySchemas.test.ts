import { describe, expect, it } from "vitest";
import { relayInput } from "../src/server/modules/cctp/cctp.schema";

import {
  previewInput,
  issueInput,
  serializedQuote,
} from "../src/server/modules/feeQuotes/feeQuotes.schema";

const quote = {
  quote: {
    formatVersion: 1 as const,
    policyVersion: 2 as const,
    quoteId: "01".repeat(32),
    networkId: "02".repeat(32),
    pool: "CPOOL",
    depositor: "CDEPOSITOR",
    commitment: "03".repeat(32),
    paymentAmount: "100",
    feeBps: 200 as const,
    feeAmount: "2",
    totalAmount: "102",
    channel: "direct" as const,
    sourceDomain: 0,
    sourcePayer: "00".repeat(32),
    issuedAt: "1",
    expiresAt: "2",
  },
  signature: "04".repeat(64),
};

describe("fee and relay API bounds", () => {
  it.each([
    "moneygram",
    "durianpay",
  ])("rejects retired channel %s at every quote boundary", (channel) => {
    expect(
      previewInput.safeParse({
        username: "alice",
        paymentAmount: "100",
        channel,
      }).success,
    ).toBe(false);
    expect(
      issueInput.safeParse({
        username: "alice",
        paymentAmount: "100",
        channel,
        depositor: "CDEPOSITOR",
        commitment: "03".repeat(32),
        salt: "04".repeat(32),
      }).success,
    ).toBe(false);
    expect(serializedQuote.safeParse({ ...quote.quote, channel }).success).toBe(
      false,
    );
  });
  it("rejects malformed and oversized public CCTP payloads", () => {
    const base = {
      username: "alice",
      sourceTxHash: `0x${"05".repeat(32)}`,
      message: "00",
      attestation: "00",
      salt: "06".repeat(32),
      feeQuote: {
        ...quote,
        quote: {
          ...quote.quote,
          channel: "cctp" as const,
          sourceDomain: 0,
          sourcePayer: "07".repeat(32),
        },
      },
    };
    expect(relayInput.safeParse({ ...base, message: "0" }).success).toBe(false);
    expect(
      relayInput.safeParse({ ...base, attestation: "aa".repeat(4_097) })
        .success,
    ).toBe(false);
  });
});
