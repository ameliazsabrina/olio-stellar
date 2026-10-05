import { nativeToScVal, type rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  parseDepositEvent,
  parseFeeEvent,
  parseSpentEvent,
} from "../src/lib/stellar";

function event(kind: string, value: xdr.ScVal): rpc.Api.EventResponse {
  return {
    id: "1-1",
    type: "contract",
    topic: [nativeToScVal(kind, { type: "symbol" })],
    value,
    ledger: 1,
    ledgerClosedAt: new Date(0).toISOString(),
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: "tx",
  };
}

describe("pool event parsing", () => {
  it("parses a spend event into a lowercase nullifier", () => {
    const nullifier = Buffer.alloc(32, 0xab);
    const parsed = parseSpentEvent(
      event("spend", xdr.ScVal.scvBytes(nullifier)),
    );

    expect(parsed).toEqual({ nullifierHex: "ab".repeat(32) });
  });

  it("does not mistake another event payload for a deposit", () => {
    const value = nativeToScVal([
      0,
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(40),
    ]);
    expect(parseDepositEvent(event("something_else", value))).toBeNull();
  });

  it("parses a typed fee event without recipient-link metadata", () => {
    const parsed = parseFeeEvent(
      event(
        "fee",
        nativeToScVal({
          payer: "GPAYER",
          fee_recipient: "GTREASURY",
          payment_amount: 1_000_000_000n,
          fee_amount: 20_000_000n,
          total_amount: 1_020_000_000n,
          policy_version: 1,
          fee_bps: 200,
          quote_id: Buffer.alloc(32, 7),
        }),
      ),
    );
    expect(parsed).toEqual({
      payer: "GPAYER",
      feeRecipient: "GTREASURY",
      paymentAmount: 1_000_000_000n,
      feeAmount: 20_000_000n,
      totalAmount: 1_020_000_000n,
      policyVersion: 1,
      feeBps: 200,
      quoteId: "07".repeat(32),
    });
  });
});
