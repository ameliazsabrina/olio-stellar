import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/lib/crypto";
import {
  parseDepositEvent,
  parseFeeEvent,
  parseSpentEvent,
  parseWithdrawEvent,
} from "../src/lib/stellar";
import { rawRowToEvent } from "../src/server/modules/goldsky/goldsky.events";
import fixture from "./fixtures/goldsky-pool-events.json";

type Case = (typeof fixture.cases)[number];
// The archive doc the webhook (Task 2) writes for this row: keyed by the RPC
// event id, naive-UTC close time stored as a UTC Date.
const toDoc = (c: Case) => ({
  _id: c.expect.rpcEventId,
  goldskyId: c.row.id,
  ledger: c.row.ledger_sequence,
  txHash: c.row.transaction_hash,
  ledgerClosedAt: new Date(`${c.row.ledger_closed_at}Z`),
  topics: c.row.topics,
  data: c.row.data,
  receivedAt: new Date(),
});

describe("rawRowToEvent", () => {
  for (const c of fixture.cases) {
    it(`decodes a real ${c.kind} row into the RPC parsers`, () => {
      const event = rawRowToEvent(toDoc(c));
      const e = c.expect as Record<string, unknown>;
      expect(event.id).toBe(e.rpcEventId);
      expect(event.ledgerClosedAt).toBe(e.ts);
      if (c.kind === "deposit") {
        const parsed = parseDepositEvent(event);
        expect(parsed?.leafIndex).toBe(e.leafIndex);
        expect(bytesToHex(parsed!.commitment)).toBe(e.commitmentHex);
        expect(bytesToHex(parsed!.ephemeralPk)).toBe(e.ephemeralPkHex);
      }
      if (c.kind === "spend")
        expect(parseSpentEvent(event)?.nullifierHex).toBe(e.nullifierHex);
      if (c.kind === "withdraw") {
        const parsed = parseWithdrawEvent(event);
        expect(parsed?.nullifierHex).toBe(e.nullifierHex);
        expect(parsed?.dest).toBe(e.dest);
        expect(parsed?.amount.toString()).toBe(e.amount);
      }
      if (c.kind === "fee") {
        const parsed = parseFeeEvent(event);
        expect(parsed?.quoteId).toBe(e.quoteId);
        expect(parsed?.feeBps).toBe(e.feeBps);
        expect(parsed?.feeAmount.toString()).toBe(e.feeAmount);
        expect(parsed?.paymentAmount.toString()).toBe(e.paymentAmount);
        expect(parsed?.totalAmount.toString()).toBe(e.totalAmount);
        expect(parsed?.payer).toBe(e.payer);
      }
    });
  }

  it("rejects non-array topics and unknown tags", () => {
    expect(() =>
      rawRowToEvent({ ...toDoc(fixture.cases[0]), topics: "{}" }),
    ).toThrow(/non-array topics/);
    expect(() =>
      rawRowToEvent({ ...toDoc(fixture.cases[0]), data: '{"f64":1}' }),
    ).toThrow(/Unsupported Goldsky ScVal tag f64/);
  });

  // Buffer.from(…, "hex") silently stops at the first bad pair.
  it("rejects bytes that are not whole hex pairs", () => {
    for (const bytes of ["zz", "abc", "ab-cd", "0x00"]) {
      expect(() =>
        rawRowToEvent({
          ...toDoc(fixture.cases[2]),
          data: `{"bytes":"${bytes}"}`,
        }),
      ).toThrow(/hex/);
    }
    expect(
      rawRowToEvent({ ...toDoc(fixture.cases[2]), data: '{"bytes":""}' }).value,
    ).toBeDefined();
  });
});
