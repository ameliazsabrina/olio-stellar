import { nativeToScVal, type rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { parseDepositEvent, parseSpentEvent } from "../src/lib/stellar";

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
});
